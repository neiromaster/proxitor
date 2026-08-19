import type {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalParams,
  CanonicalRequest,
  CanonicalSystemBlock,
  CanonicalTool,
  CanonicalToolChoice,
  ExtensionsBag,
  ImageSource,
  MaxTokens,
  NodeExtensions,
  ResponseFormat,
} from '@proxitor/plugin-api';
import { invalidRequest, parseJsonBody } from '../shared/format-error.js';
import { asArray, asObject, asString, type Json } from '../shared/validate.js';
import { WIRE_KEY } from '../shared/wire.js';

const KNOWN_TOP_LEVEL = new Set([
  'model',
  'messages',
  'max_tokens',
  'max_completion_tokens',
  'max_output_tokens',
  'temperature',
  'top_p',
  'stop',
  'seed',
  'n',
  'response_format',
  'presence_penalty',
  'frequency_penalty',
  'tools',
  'tool_choice',
  'stream',
  'stream_options',
]);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: straightforward codec with linear control flow
export function decodeOpenAiRequest(body: string): CanonicalRequest {
  const wire = parseJsonBody(body);
  const model = asString(wire.model, 'model');
  const rawMessages = asArray(wire.messages, 'messages');
  if (rawMessages.length === 0) throw invalidRequest('messages must not be empty');

  const bag: Json = {};
  for (const [key, value] of Object.entries(wire)) {
    if (!KNOWN_TOP_LEVEL.has(key)) bag[key] = value;
  }

  const system: CanonicalSystemBlock[] = [];
  const messages: CanonicalMessage[] = [];
  let pendingToolResults: CanonicalContentBlock[] = [];

  for (const raw of rawMessages) {
    const message = asObject(raw, 'messages entry');
    const role = asString(message.role, 'messages[].role');
    if (role === 'system' || role === 'developer') {
      system.push(decodeSystemMessage(message, role));
      continue;
    }
    if (role === 'tool') {
      pendingToolResults.push(decodeToolResult(message));
      continue;
    }
    if (role === 'assistant') {
      if (pendingToolResults.length > 0) {
        messages.push({ role: 'user', content: pendingToolResults });
        pendingToolResults = [];
      }
      messages.push(decodeAssistantMessage(message));
      continue;
    }
    if (role === 'user') {
      const blocks = decodeContentParts(message.content);
      if (pendingToolResults.length > 0) {
        blocks.unshift(...pendingToolResults);
        pendingToolResults = [];
      }
      messages.push(
        withExtensions(
          { role: 'user', content: blocks },
          message,
          new Set(['role', 'content']),
          {
            contentString: typeof message.content === 'string',
          },
        ),
      );
      continue;
    }
    throw invalidRequest(
      `unsupported message role '${role}' (legacy function calls are out of scope)`,
    );
  }
  if (pendingToolResults.length > 0)
    messages.push({ role: 'user', content: pendingToolResults });

  const request: CanonicalRequest = {
    model: { logical: model, physical: model },
    system,
    messages,
    params: {},
    stream: wire.stream === true,
    extensions: { 'openai-chat': bag } satisfies ExtensionsBag,
  };
  applyParams(request.params, wire, bag);
  if (wire.tools !== undefined)
    request.tools = asArray(wire.tools, 'tools').map(tool => decodeTool(tool));
  request.toolChoice = decodeToolChoice(wire.tool_choice, bag);
  return request;
}

function decodeSystemMessage(message: Json, role: string): CanonicalSystemBlock {
  const flags: Json = {};
  let text: string;
  if (typeof message.content === 'string') {
    text = message.content;
  } else {
    text = asArray(message.content, 'system content')
      .map(part =>
        asString(asObject(part, 'system content part').text, 'system content part text'),
      )
      .join('');
    flags.systemContentParts = true;
  }
  if (role === 'developer') flags.role = 'developer';
  if (typeof message.name === 'string') flags.name = message.name;
  return {
    type: 'text',
    text,
    ...(Object.keys(flags).length > 0 ? { extensions: { [WIRE_KEY]: flags } } : {}),
  };
}

function decodeContentParts(content: unknown): CanonicalContentBlock[] {
  if (content === undefined || content === null) return [];
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return asArray(content, 'content parts').map(part => decodePart(part));
}

function decodePart(part: unknown): CanonicalContentBlock {
  const wirePart = asObject(part, 'content part');
  const extra = nodeExtensions(wirePart, new Set(['type', 'text', 'image_url']));
  switch (wirePart.type) {
    case 'text':
      return {
        type: 'text',
        text: asString(wirePart.text, 'text part text'),
        ...(extra ? { extensions: extra } : {}),
      };
    case 'image_url': {
      const image = asObject(wirePart.image_url, 'image_url part');
      const url = asString(image.url, 'image_url url');
      const dataUrl = /^data:([^;,]+)(?:;[^;,]*)*;base64,([\s\S]*)$/.exec(url);
      if (dataUrl) {
        const source: ImageSource = {
          kind: 'base64',
          mediaType: dataUrl[1] ?? 'application/octet-stream',
          data: dataUrl[2] ?? '',
        };
        return { type: 'image', source, ...(extra ? { extensions: extra } : {}) };
      }
      return {
        type: 'image',
        source: { kind: 'url', url },
        ...(extra ? { extensions: extra } : {}),
      };
    }
    default:
      throw invalidRequest(`unconvertible content part type '${String(wirePart.type)}'`);
  }
}

function decodeAssistantMessage(message: Json): CanonicalMessage {
  const flags: Json = {};
  if (message.content === null) flags.contentNull = true;
  if (typeof message.name === 'string') flags.name = message.name;
  const content = decodeContentParts(message.content);
  const toolCalls =
    message.tool_calls === undefined
      ? []
      : asArray(message.tool_calls, 'tool_calls').map(toolCall =>
          decodeToolCall(toolCall),
        );
  return withExtensions(
    { role: 'assistant', content: [...content, ...toolCalls] },
    message,
    new Set(['role', 'content', 'tool_calls', 'name']),
    flags,
  );
}

function decodeToolCall(toolCall: unknown): CanonicalContentBlock {
  const wireToolCall = asObject(toolCall, 'tool_calls entry');
  const id = asString(wireToolCall.id, 'tool_calls id');
  const fn = asObject(wireToolCall.function ?? {}, 'tool_calls function');
  const name = asString(fn.name, 'tool_calls function name');
  const input =
    typeof fn.arguments === 'string'
      ? parseJsonLoose(fn.arguments)
      : (fn.arguments ?? {});
  return { type: 'tool_use', id, name, input };
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function decodeToolResult(message: Json): CanonicalContentBlock {
  const toolUseId = asString(message.tool_call_id, 'tool message tool_call_id');
  const content =
    typeof message.content === 'string'
      ? message.content
      : asArray(message.content ?? [], 'tool message content')
          .map(part =>
            asString(asObject(part, 'tool content part').text, 'tool content part text'),
          )
          .join('');
  return { type: 'tool_result', toolUseId, content };
}

function applyParams(params: CanonicalParams, wire: Json, bag: Json): void {
  const max = pickMaxTokens(wire);
  if (max !== undefined) params.maxTokens = max;
  if (typeof wire.temperature === 'number') params.temperature = wire.temperature;
  if (typeof wire.top_p === 'number') params.topP = wire.top_p;
  if (wire.stop !== undefined) {
    if (typeof wire.stop === 'string') {
      params.stop = [wire.stop];
      wireFlag(bag, 'stopString', true);
    } else {
      params.stop = asArray(wire.stop, 'stop').map(entry =>
        asString(entry, 'stop entry'),
      );
    }
  }
  if (typeof wire.seed === 'number') params.seed = wire.seed;
  if (typeof wire.n === 'number') params.n = wire.n;
  if (wire.response_format !== undefined)
    params.responseFormat = decodeResponseFormat(wire.response_format, bag);
  if (typeof wire.presence_penalty === 'number')
    params.presencePenalty = wire.presence_penalty;
  if (typeof wire.frequency_penalty === 'number')
    params.frequencyPenalty = wire.frequency_penalty;
}

function pickMaxTokens(wire: Json): MaxTokens | undefined {
  if (typeof wire.max_completion_tokens === 'number')
    return { value: wire.max_completion_tokens, source: 'max_completion_tokens' };
  if (typeof wire.max_tokens === 'number')
    return { value: wire.max_tokens, source: 'max_tokens' };
  if (typeof wire.max_output_tokens === 'number')
    return { value: wire.max_output_tokens, source: 'max_output_tokens' };
  return undefined;
}

function decodeResponseFormat(value: unknown, bag: Json): ResponseFormat {
  const rf = asObject(value, 'response_format');
  if (rf.type === 'json_object') return { kind: 'json' };
  if (rf.type === 'json_schema') {
    const js = asObject(rf.json_schema, 'response_format.json_schema');
    if (typeof js.name === 'string') wireFlag(bag, 'jsonSchemaName', js.name);
    if (js.strict !== undefined) wireFlag(bag, 'jsonSchemaStrict', js.strict);
    return {
      kind: 'json_schema',
      schema: asObject(js.schema ?? {}, 'response_format.json_schema.schema'),
    };
  }
  throw invalidRequest(`unconvertible response_format type '${String(rf.type)}'`);
}

function decodeTool(tool: unknown): CanonicalTool {
  const wireTool = asObject(tool, 'tool');
  const fn = asObject(wireTool.function ?? {}, 'tool function');
  const out: CanonicalTool = {
    name: asString(fn.name, 'tool function name'),
    inputSchema: asObject(fn.parameters ?? {}, 'tool function parameters'),
  };
  if (typeof fn.description === 'string') out.description = fn.description;
  return out;
}

function decodeToolChoice(choice: unknown, bag: Json): CanonicalToolChoice | undefined {
  if (choice === undefined) return undefined;
  if (typeof choice === 'string') {
    if (choice === 'auto' || choice === 'none') return { mode: choice };
    if (choice === 'required') return { mode: 'any' };
    throw invalidRequest(`unconvertible tool_choice '${choice}'`);
  }
  const wireChoice = asObject(choice, 'tool_choice');
  wireFlag(bag, 'toolChoiceObject', true);
  if (wireChoice.type === 'function') {
    const fn = asObject(wireChoice.function ?? {}, 'tool_choice function');
    return { mode: 'tool', name: asString(fn.name, 'tool_choice function name') };
  }
  if (wireChoice.type === 'auto' || wireChoice.type === 'none') {
    return { mode: wireChoice.type };
  }
  throw invalidRequest(`unconvertible tool_choice type '${String(wireChoice.type)}'`);
}

function withExtensions(
  message: CanonicalMessage,
  wireMessage: Json,
  known: Set<string>,
  flags: Json,
): CanonicalMessage {
  const extras = nodeExtensions(wireMessage, known) ?? {};
  const extensions: NodeExtensions = {
    ...extras,
    ...(Object.keys(flags).length > 0 ? { [WIRE_KEY]: flags } : {}),
  };
  return Object.keys(extensions).length > 0 ? { ...message, extensions } : message;
}

function wireFlag(bag: Json, key: string, value: unknown): void {
  const meta = (bag[WIRE_KEY] as Json | undefined) ?? {};
  meta[key] = value;
  bag[WIRE_KEY] = meta;
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
