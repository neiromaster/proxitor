import type {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalRequest,
  CanonicalSystemBlock,
  CanonicalTool,
  CanonicalToolChoice,
  ExtensionsBag,
} from '@proxitor/plugin-api';
import { invalidRequest, parseJsonBody } from '../shared/format-error.js';
import { asArray, asObject, asString, type Json } from '../shared/validate.js';
import { toCacheControl, WIRE_KEY } from '../shared/wire.js';

const KNOWN_TOP_LEVEL = new Set([
  'model',
  'messages',
  'max_tokens',
  'system',
  'tools',
  'tool_choice',
  'temperature',
  'top_p',
  'top_k',
  'stop_sequences',
  'stream',
]);

export function decodeAnthropicRequest(body: string): CanonicalRequest {
  const wire = parseJsonBody(body);
  const model = asString(wire.model, 'model');
  const rawMessages = asArray(wire.messages, 'messages');
  if (rawMessages.length === 0) throw invalidRequest('messages must not be empty');
  const maxTokens = wire.max_tokens;
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens)) {
    throw invalidRequest('max_tokens is required and must be a number');
  }

  const bag: Json = {};
  for (const [key, value] of Object.entries(wire)) {
    if (!KNOWN_TOP_LEVEL.has(key)) bag[key] = value;
  }

  const wireMeta: Json = {};
  if ('stream' in wire && wire.stream === false) wireMeta.streamFalse = true;

  const request: CanonicalRequest = {
    model: { logical: model, physical: model },
    system: decodeSystem(wire.system, bag, wireMeta),
    messages: rawMessages.map(message => decodeMessage(message)),
    params: { maxTokens: { value: maxTokens, source: 'max_tokens' } },
    stream: wire.stream === true,
    extensions: {
      'anthropic-messages': {
        ...bag,
        ...(Object.keys(wireMeta).length > 0 ? { [WIRE_KEY]: wireMeta } : {}),
      } satisfies ExtensionsBag,
    },
  };

  const params = request.params;
  if (typeof wire.temperature === 'number') params.temperature = wire.temperature;
  if (typeof wire.top_p === 'number') params.topP = wire.top_p;
  if (typeof wire.top_k === 'number') params.topK = wire.top_k;
  if (wire.stop_sequences !== undefined) {
    params.stop = asArray(wire.stop_sequences, 'stop_sequences').map(entry =>
      asString(entry, 'stop_sequences entry'),
    );
  }
  if (wire.tools !== undefined) {
    request.tools = asArray(wire.tools, 'tools').map(tool => decodeTool(tool));
  }
  request.toolChoice = decodeToolChoice(wire.tool_choice);
  return request;
}

function decodeSystem(
  system: unknown,
  _bag: Json,
  wireMeta: Json,
): CanonicalSystemBlock[] {
  if (system === undefined) return [];
  if (typeof system === 'string') {
    wireMeta.systemString = true;
    return [{ type: 'text', text: system }];
  }
  return asArray(system, 'system').map(block => {
    const wireBlock = asObject(block, 'system block');
    if (wireBlock.type !== 'text') {
      throw invalidRequest(`unconvertible system block type '${String(wireBlock.type)}'`);
    }
    return {
      type: 'text' as const,
      text: asString(wireBlock.text, 'system block text'),
      cacheControl: toCacheControl(wireBlock.cache_control),
      extensions: nodeExtensions(wireBlock, new Set(['type', 'text', 'cache_control'])),
    };
  });
}

function decodeMessage(message: unknown): CanonicalMessage {
  const wireMessage = asObject(message, 'messages entry');
  const role = asString(wireMessage.role, 'messages[].role');
  if (role !== 'user' && role !== 'assistant') {
    throw invalidRequest(`messages[].role must be 'user' or 'assistant', got '${role}'`);
  }
  const wireMeta: Json = {};
  if (typeof wireMessage.content === 'string') wireMeta.contentString = true;
  const extras = nodeExtensions(wireMessage, new Set(['role', 'content']));
  const extensions = {
    ...extras,
    ...(Object.keys(wireMeta).length > 0 ? { [WIRE_KEY]: wireMeta } : {}),
  };
  return {
    role,
    content: decodeContent(wireMessage.content),
    ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
  };
}

function decodeContent(content: unknown): CanonicalContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return asArray(content ?? [], 'messages[].content').map(block => decodeBlock(block));
}

function decodeBlock(block: unknown): CanonicalContentBlock {
  const wireBlock = asObject(block, 'content block');
  const common = {
    cacheControl: toCacheControl(wireBlock.cache_control),
    extensions: nodeExtensions(wireBlock, new Set(['type', 'cache_control'])),
  };
  switch (wireBlock.type) {
    case 'text':
      return {
        type: 'text',
        text: asString(wireBlock.text, 'text block text'),
        ...common,
        extensions: nodeExtensions(wireBlock, new Set(['type', 'text', 'cache_control'])),
      };
    case 'image': {
      const source = asObject(wireBlock.source, 'image block source');
      if (source.type === 'base64') {
        return {
          type: 'image' as const,
          source: {
            kind: 'base64',
            mediaType: asString(source.media_type, 'image media_type'),
            data: asString(source.data, 'image data'),
          },
          cacheControl: toCacheControl(wireBlock.cache_control),
          extensions: nodeExtensions(
            wireBlock,
            new Set(['type', 'source', 'cache_control']),
          ),
        };
      }
      if (source.type === 'url') {
        return {
          type: 'image' as const,
          source: { kind: 'url', url: asString(source.url, 'image url') },
          cacheControl: toCacheControl(wireBlock.cache_control),
          extensions: nodeExtensions(
            wireBlock,
            new Set(['type', 'source', 'cache_control']),
          ),
        };
      }
      throw invalidRequest(`unconvertible image source type '${String(source.type)}'`);
    }
    case 'tool_use':
      return {
        type: 'tool_use' as const,
        id: asString(wireBlock.id, 'tool_use id'),
        name: asString(wireBlock.name, 'tool_use name'),
        input: wireBlock.input ?? {},
        ...common,
        extensions: nodeExtensions(
          wireBlock,
          new Set(['type', 'id', 'name', 'input', 'cache_control']),
        ),
      };
    case 'tool_result': {
      const wireMeta: Json = {};
      let content: CanonicalContentBlock[] | string;
      if (typeof wireBlock.content === 'string') {
        content = wireBlock.content;
        wireMeta.contentString = true;
      } else {
        content = asArray(wireBlock.content ?? [], 'tool_result content').map(inner =>
          decodeBlock(inner),
        );
      }
      let isError: true | false | undefined;
      if (wireBlock.is_error === true) {
        isError = true;
      } else if (wireBlock.is_error === false) {
        isError = false;
      }
      return {
        type: 'tool_result' as const,
        toolUseId: asString(wireBlock.tool_use_id, 'tool_result tool_use_id'),
        content,
        isError,
        ...common,
        extensions: nodeExtensions(
          wireBlock,
          new Set(['type', 'tool_use_id', 'content', 'is_error', 'cache_control']),
        ),
        ...(Object.keys(wireMeta).length > 0
          ? {
              extensions: {
                ...nodeExtensions(
                  wireBlock,
                  new Set([
                    'type',
                    'tool_use_id',
                    'content',
                    'is_error',
                    'cache_control',
                  ]),
                ),
                [WIRE_KEY]: wireMeta,
              },
            }
          : {}),
      };
    }
    case 'thinking':
      return {
        type: 'thinking' as const,
        thinking: asString(wireBlock.thinking, 'thinking block thinking'),
        signature:
          typeof wireBlock.signature === 'string' ? wireBlock.signature : undefined,
        ...common,
        extensions: nodeExtensions(
          wireBlock,
          new Set(['type', 'thinking', 'signature', 'cache_control']),
        ),
      };
    default:
      throw invalidRequest(
        `unconvertible content block type '${String(wireBlock.type)}'`,
      );
  }
}

function decodeTool(tool: unknown): CanonicalTool {
  const wireTool = asObject(tool, 'tool');
  return {
    name: asString(wireTool.name, 'tool name'),
    description:
      typeof wireTool.description === 'string' ? wireTool.description : undefined,
    inputSchema: asObject(wireTool.input_schema ?? {}, 'tool input_schema'),
    cacheControl: toCacheControl(wireTool.cache_control),
  };
}

function decodeToolChoice(choice: unknown): CanonicalToolChoice | undefined {
  if (choice === undefined) return undefined;
  const wireChoice = asObject(choice, 'tool_choice');
  if (
    wireChoice.type === 'auto' ||
    wireChoice.type === 'any' ||
    wireChoice.type === 'none'
  ) {
    return { mode: wireChoice.type };
  }
  if (wireChoice.type === 'tool') {
    return { mode: 'tool', name: asString(wireChoice.name, 'tool_choice name') };
  }
  throw invalidRequest(`unconvertible tool_choice type '${String(wireChoice.type)}'`);
}

function nodeExtensions(
  wireObject: Json,
  known: Set<string>,
): Record<string, unknown> | undefined {
  const extras: Json = {};
  for (const [key, value] of Object.entries(wireObject)) {
    if (!known.has(key)) extras[key] = value;
  }
  return Object.keys(extras).length > 0 ? extras : undefined;
}
