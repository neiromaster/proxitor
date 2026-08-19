import type {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalParams,
  CanonicalRequest,
  CanonicalSystemBlock,
  CanonicalTool,
  CanonicalToolChoice,
  MaxTokens,
  NodeExtensions,
} from '@proxitor/plugin-api';
import { FormatError } from '../shared/format-error.js';
import type { Json } from '../shared/validate.js';
import { readWireMeta, WIRE_KEY } from '../shared/wire.js';

const PROXITOR_PREFIX = '$proxitor.';
const PROXITOR_RESERVED = [
  '$proxitor.provider',
  '$proxitor.models',
  '$proxitor.route',
  '$proxitor.transforms',
];

export type OpenAiMaxTokensField = 'auto' | 'max_tokens' | 'max_completion_tokens';
export type OpenAiEncodeOptions = { maxTokensField?: OpenAiMaxTokensField };

export function encodeOpenAiRequest(
  ir: CanonicalRequest,
  options?: OpenAiEncodeOptions,
): string {
  if (ir.params.topK !== undefined) {
    throw new FormatError({
      type: 'invalid_request_error',
      message: 'top_k is not expressible in openai-chat requests',
      status: 400,
    });
  }
  const bag: Json = { ...ir.extensions['openai-chat'] };
  const meta = readWireMeta({ [WIRE_KEY]: bag[WIRE_KEY] });

  const wire: Json & { messages: Json[] } = { model: ir.model.physical, messages: [] };
  for (const block of ir.system) appendSystemMessage(wire, block);
  wire.messages.push(...encodeMessages(ir.messages));

  applyParams(wire, ir.params, ir.model.physical, meta, options);
  applyTools(wire, ir.tools, ir.toolChoice, meta);
  applyPassthrough(wire, bag, ir.stream);

  return JSON.stringify(wire);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: straightforward codec with linear param mapping
function applyParams(
  wire: Json & { messages: Json[] },
  params: CanonicalParams,
  model: string,
  meta: Record<string, unknown>,
  options?: OpenAiEncodeOptions,
): void {
  if (params.maxTokens !== undefined) {
    wire[
      resolveMaxTokensField(
        model,
        params.maxTokens.source,
        options?.maxTokensField ?? 'auto',
      )
    ] = params.maxTokens.value;
  }
  if (params.temperature !== undefined) wire.temperature = params.temperature;
  if (params.topP !== undefined) wire.top_p = params.topP;
  if (params.stop !== undefined)
    wire.stop = meta.stopString === true ? params.stop[0] : params.stop;
  if (params.seed !== undefined) wire.seed = params.seed;
  if (params.n !== undefined) wire.n = params.n;
  if (params.responseFormat !== undefined) {
    wire.response_format =
      params.responseFormat.kind === 'json'
        ? { type: 'json_object' }
        : {
            type: 'json_schema',
            json_schema: {
              ...(typeof meta.jsonSchemaName === 'string'
                ? { name: meta.jsonSchemaName }
                : {}),
              ...(meta.jsonSchemaStrict !== undefined
                ? { strict: meta.jsonSchemaStrict }
                : {}),
              schema: params.responseFormat.schema,
            },
          };
  }
  if (params.presencePenalty !== undefined)
    wire.presence_penalty = params.presencePenalty;
  if (params.frequencyPenalty !== undefined)
    wire.frequency_penalty = params.frequencyPenalty;
}

function applyTools(
  wire: Json & { messages: Json[] },
  tools: CanonicalTool[] | undefined,
  toolChoice: CanonicalToolChoice | undefined,
  meta: Record<string, unknown>,
): void {
  if (tools !== undefined && tools.length > 0) {
    wire.tools = tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
  if (toolChoice !== undefined)
    wire.tool_choice = encodeToolChoice(toolChoice, meta.toolChoiceObject === true);
}

function applyPassthrough(
  wire: Json & { messages: Json[] },
  bag: Json,
  stream: boolean,
): void {
  if (stream) {
    wire.stream = true;
    wire.stream_options = { include_usage: true };
  }
  for (const [key, value] of Object.entries(bag)) {
    if (key === WIRE_KEY || key.startsWith(PROXITOR_PREFIX)) continue;
    wire[key] = value;
  }
  for (const key of PROXITOR_RESERVED) {
    if (bag[key] !== undefined) wire[key.slice(PROXITOR_PREFIX.length)] = bag[key];
  }
}

function resolveMaxTokensField(
  model: string,
  source: MaxTokens['source'],
  option: OpenAiMaxTokensField,
): 'max_tokens' | 'max_completion_tokens' {
  if (option === 'max_tokens' || option === 'max_completion_tokens') return option;
  if (/^(o\d|gpt-5)/.test(model)) return 'max_completion_tokens';
  return source === 'max_tokens' || source === 'max_completion_tokens'
    ? source
    : 'max_tokens';
}

function encodeToolChoice(
  choice: CanonicalToolChoice,
  wasObject: boolean,
): string | Json {
  if (choice.mode === 'tool')
    return { type: 'function', function: { name: choice.name } };
  if (choice.mode === 'any') return 'required';
  return wasObject ? { type: choice.mode } : choice.mode;
}

function appendSystemMessage(wire: Json, block: CanonicalSystemBlock): void {
  const meta = readWireMeta(block.extensions);
  const message: Json = {
    role: meta.role === 'developer' ? 'developer' : 'system',
    content:
      meta.systemContentParts === true
        ? [{ type: 'text', text: block.text }]
        : block.text,
  };
  if (typeof meta.name === 'string') message.name = meta.name;
  (wire.messages as Json[]).push(message);
}

function encodeMessages(irMessages: CanonicalMessage[]): Json[] {
  const out: Json[] = [];
  for (const message of irMessages) {
    const toolResults = message.content.filter(block => block.type === 'tool_result');
    const rest = message.content.filter(block => block.type !== 'tool_result');
    for (const block of toolResults) {
      out.push({
        role: 'tool',
        tool_call_id: block.toolUseId,
        content: encodeToolResultContent(block),
      });
    }
    if (message.role === 'assistant') {
      out.push(encodeAssistantMessage(message, rest));
    } else if (rest.length > 0 || toolResults.length === 0) {
      out.push(encodeUserMessage(message, rest));
    }
  }
  return out;
}

function encodeToolResultContent(
  block: Extract<CanonicalContentBlock, { type: 'tool_result' }>,
): string {
  if (typeof block.content === 'string') return block.content;
  const parts: string[] = [];
  for (const inner of block.content) {
    if (inner.type === 'text') {
      parts.push(inner.text);
    } else {
      throw new FormatError({
        type: 'invalid_request_error',
        message: `tool_result ${inner.type} content is not expressible in openai-chat tool messages`,
        status: 400,
      });
    }
  }
  return parts.join('\n');
}

function encodeUserMessage(
  message: CanonicalMessage,
  rest: CanonicalContentBlock[],
): Json {
  const meta = readWireMeta(message.extensions);
  const single =
    rest.length === 1 &&
    rest[0]?.type === 'text' &&
    rest[0].cacheControl === undefined &&
    rest[0].extensions === undefined;
  const out: Json = { role: 'user' };
  if (rest.length === 0) {
    out.content = '';
  } else if (meta.contentString === true && single) {
    out.content = (rest[0] as Extract<CanonicalContentBlock, { type: 'text' }>).text;
  } else {
    out.content = rest.map(encodeUserPart);
  }
  Object.assign(out, passthrough(message.extensions));
  return out;
}

function encodeAssistantMessage(
  message: CanonicalMessage,
  rest: CanonicalContentBlock[],
): Json {
  const meta = readWireMeta(message.extensions);
  const texts: string[] = [];
  const toolUses: Extract<CanonicalContentBlock, { type: 'tool_use' }>[] = [];
  for (const block of rest) {
    if (block.type === 'text') texts.push(block.text);
    else if (block.type === 'tool_use') toolUses.push(block);
    else if (block.type === 'thinking')
      continue; // cross-format thinking drop (spec §4.1)
    else {
      throw new FormatError({
        type: 'invalid_request_error',
        message: `assistant ${block.type} blocks are not expressible in openai-chat messages`,
        status: 400,
      });
    }
  }
  const text = texts.join('');
  const out: Json = { role: 'assistant' };
  if (typeof meta.name === 'string') out.name = meta.name;
  if (meta.contentNull === true) {
    out.content = null;
  } else if (text === '' && toolUses.length > 0) {
    out.content = null;
  } else {
    out.content = text;
  }
  if (toolUses.length > 0) {
    out.tool_calls = toolUses.map(block => ({
      id: block.id,
      type: 'function',
      function: {
        name: block.name,
        arguments:
          typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input ?? {}),
      },
      ...passthrough(block.extensions),
    }));
  }
  return out;
}

function encodeUserPart(block: CanonicalContentBlock): Json {
  const extra = passthrough(block.extensions);
  if (block.type === 'text') return { type: 'text', text: block.text, ...extra };
  if (block.type === 'image') {
    const url =
      block.source.kind === 'url'
        ? block.source.url
        : `data:${block.source.mediaType};base64,${block.source.data}`;
    return { type: 'image_url', image_url: { url }, ...extra };
  }
  throw new FormatError({
    type: 'invalid_request_error',
    message: `user ${block.type} blocks are not expressible in openai-chat user content`,
    status: 400,
  });
}

function passthrough(extensions?: NodeExtensions): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(extensions ?? {})) {
    if (key === WIRE_KEY) continue;
    out[key] = value;
  }
  return out;
}
