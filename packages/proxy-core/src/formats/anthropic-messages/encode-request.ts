import type {
  CanonicalContentBlock,
  CanonicalRequest,
  CanonicalSystemBlock,
  NodeExtensions,
} from '@proxitor/plugin-api';
import { FormatError } from '../shared/format-error.js';
import type { Json } from '../shared/validate.js';
import { fromCacheControl, readWireMeta, WIRE_KEY } from '../shared/wire.js';

const PROXITOR_PREFIX = '$proxitor.';

export function encodeAnthropicRequest(ir: CanonicalRequest): string {
  const bag: Json = { ...ir.extensions['anthropic-messages'] };
  const wireMeta = readWireMeta({ [WIRE_KEY]: bag[WIRE_KEY] });

  validateExpressibleParams(ir);

  const wire: Json = {
    model: ir.model.physical,
    max_tokens: ir.params.maxTokens?.value,
    messages: ir.messages.map(encodeMessage),
  };
  encodeOptionalFields(ir, wire, wireMeta, bag);
  return JSON.stringify(wire);
}

function validateExpressibleParams(ir: CanonicalRequest): void {
  if (ir.params.seed !== undefined) {
    throw new FormatError({
      type: 'invalid_request_error',
      message: 'seed is not expressible in anthropic-messages requests',
      status: 400,
    });
  }
  if (ir.params.responseFormat !== undefined) {
    throw new FormatError({
      type: 'invalid_request_error',
      message: 'responseFormat is not expressible in anthropic-messages requests',
      status: 400,
    });
  }
  if (
    ir.params.presencePenalty !== undefined ||
    ir.params.frequencyPenalty !== undefined
  ) {
    throw new FormatError({
      type: 'invalid_request_error',
      message:
        'presence/frequency penalties are not expressible in anthropic-messages requests',
      status: 400,
    });
  }
}

function encodeOptionalFields(
  ir: CanonicalRequest,
  wire: Json,
  wireMeta: Json,
  bag: Json,
): void {
  encodeSystemField(ir, wire, wireMeta);
  encodeParamFields(ir, wire);
  encodeToolsField(ir, wire);
  encodeStreamField(ir, wire, wireMeta);
  encodePassthroughFields(bag, wire);
}

function encodeSystemField(ir: CanonicalRequest, wire: Json, wireMeta: Json): void {
  if (ir.system.length > 0)
    wire.system = encodeSystem(ir.system, wireMeta.systemString === true);
}

function encodeParamFields(ir: CanonicalRequest, wire: Json): void {
  if (ir.params.temperature !== undefined) wire.temperature = ir.params.temperature;
  if (ir.params.topP !== undefined) wire.top_p = ir.params.topP;
  if (ir.params.topK !== undefined) wire.top_k = ir.params.topK;
  if (ir.params.stop !== undefined) wire.stop_sequences = ir.params.stop;
}

function encodeToolsField(ir: CanonicalRequest, wire: Json): void {
  if (ir.tools !== undefined && ir.tools.length > 0) {
    wire.tools = ir.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
      cache_control: fromCacheControl(tool.cacheControl),
    }));
  }
  if (ir.toolChoice !== undefined) {
    wire.tool_choice =
      ir.toolChoice.mode === 'tool'
        ? { type: 'tool', name: ir.toolChoice.name }
        : { type: ir.toolChoice.mode };
  }
}

function encodeStreamField(ir: CanonicalRequest, wire: Json, wireMeta: Json): void {
  if (ir.stream) {
    wire.stream = true;
  } else if (wireMeta.streamFalse === true) {
    wire.stream = false;
  }
}

function encodePassthroughFields(bag: Json, wire: Json): void {
  for (const [key, value] of Object.entries(bag)) {
    if (key === WIRE_KEY || key.startsWith(PROXITOR_PREFIX)) continue;
    wire[key] = value;
  }
}

function encodeSystem(
  system: CanonicalSystemBlock[],
  wasString: boolean,
): string | CanonicalSystemBlock[] {
  const blocks = system.map(block => {
    const cacheControl = fromCacheControl(block.cacheControl);
    const extra = passthrough(block.extensions);
    const hasExtras = Object.keys(extra).length > 0;
    if (cacheControl === undefined && !hasExtras) {
      return { type: 'text' as const, text: block.text };
    }
    return {
      type: 'text' as const,
      text: block.text,
      cache_control: cacheControl,
      ...extra,
    };
  });
  if (wasString && blocks.length === 1) return system[0]?.text ?? '';
  return blocks;
}

function encodeMessage(message: {
  role: 'user' | 'assistant';
  content: CanonicalContentBlock[];
  extensions?: NodeExtensions;
}): Json {
  const meta = readWireMeta(message.extensions);
  const first = message.content[0];
  const plainSingle =
    message.content.length === 1 &&
    first?.type === 'text' &&
    first.cacheControl === undefined &&
    first.extensions === undefined;
  const out: Json = { role: message.role };
  out.content =
    meta.contentString === true && plainSingle
      ? first.text
      : message.content.map(encodeBlock);
  Object.assign(out, passthrough(message.extensions));
  return out;
}

function passthrough(extensions?: NodeExtensions): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(extensions ?? {})) {
    if (key === WIRE_KEY) continue;
    out[key] = value;
  }
  return out;
}

function encodeBlock(block: CanonicalContentBlock): Json {
  const cache = { cache_control: fromCacheControl(block.cacheControl) };
  const extra = passthrough(block.extensions);
  const wire = { ...extra, ...cache } as Json;
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text, ...wire };
    case 'image':
      return {
        type: 'image',
        source:
          block.source.kind === 'base64'
            ? {
                type: 'base64',
                media_type: block.source.mediaType,
                data: block.source.data,
              }
            : { type: 'url', url: block.source.url },
        ...wire,
      };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
        ...wire,
      };
    case 'tool_result': {
      const content =
        typeof block.content === 'string'
          ? block.content
          : block.content.map(encodeBlock);
      let isError: true | false | undefined;
      if (block.isError === true) {
        isError = true;
      } else if (block.isError === false) {
        isError = false;
      }
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content,
        is_error: isError,
        ...wire,
      };
    }
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        signature: block.signature,
        ...wire,
      };
  }
}
