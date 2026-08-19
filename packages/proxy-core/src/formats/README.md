# Format Adapters

This directory contains the format adapter implementations for transforming between provider-specific wire formats and the canonical IR.

## Supported Formats

| Format | Request Decode | Request Encode | Response Decode | Response Encode | Stream Decode | Stream Encode |
|--------|----------------|----------------|-----------------|-----------------|---------------|----------------|
| anthropic-messages | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| openai-chat | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Cross-Format Compatibility

### Fields Dropped During Translation

The following fields are not preserved when translating between formats:

| Source Format | Field | Target Format | Reason |
|---------------|-------|---------------|--------|
| anthropic-messages | `cache_control` | openai-chat | Not supported by OpenAI API |
| anthropic-messages | `is_error` (tool_result) | openai-chat | Not supported by OpenAI API |
| openai-chat | `thinking` (request) | anthropic-messages | Anthropic only supports thinking in beta API |

### Fields That Fail Loudly

The following fields will cause translation failures:

| Source Format | Field | Target Format | Error Type |
|---------------|-------|---------------|------------|
| anthropic-messages | `top_k` | openai-chat | FormatError |
| openai-chat | `seed` | anthropic-messages | FormatError |
| openai-chat | `response_format` | anthropic-messages | FormatError |
| openai-chat | `presence_penalty` | anthropic-messages | FormatError |
| openai-chat | `frequency_penalty` | anthropic-messages | FormatError |
| openai-chat | `tool_result` with non-text content | anthropic-messages | FormatError |

### Image Source Shapes

| Source | Target | Behavior |
|--------|--------|----------|
| anthropic `image.source.base64` | openai-chat | Converted to `image_url.url` with `data:` URL |
| anthropic `image.source.url` | openai-chat | Converted to `image_url.url` (passed through) |
| openai-chat `image_url.url` | anthropic-messages | Converted to `image.source.url` if HTTP URL, rejected if `data:` URL |

### Identity Gaps

The following constructions cannot be perfectly represented in the target format:

| Source Format | Construction | Target Format | Gap |
|---------------|--------------|---------------|-----|
| openai-chat | Multi-part `system` message content | anthropic-messages | Collapsed to single text block |
| openai-chat | Array-form `tool` message content | anthropic-messages | Only single tool result per message supported |
| openai-chat | Assistant message with multiple text parts | anthropic-messages | Collapsed to single text block |
| openai-chat | `n > 1` in request | anthropic-messages | Only first choice returned |
| anthropic-messages | `signature` delta | openai-chat | Dropped (not supported) |

### Reserved Namespaces

- `$wire` - Codec-internal wire format metadata. Plugins MUST NOT write to this namespace.
- `$proxitor.*` - Reserved for proxy implementation details. Plugins MUST NOT write to this namespace.

### Usage and Stop Reason Mapping

| Source Format | Usage Field | Target Format | Usage Field |
|---------------|-------------|---------------|-------------|
| anthropic-messages | `input_tokens`, `output_tokens` | openai-chat | `prompt_tokens`, `completion_tokens`, `total_tokens` |
| openai-chat | `prompt_tokens`, `completion_tokens` | anthropic-messages | `input_tokens`, `output_tokens` |

### Stop Reason Translation

| anthropic-messages | openai-chat |
|---------------------|--------------|
| `end_turn` | `stop` |
| `max_tokens` | `length` |
| `stop_sequence` | `stop` |
| `tool_use` | `tool_calls` |

## Registry

The `FORMAT_ADAPTERS` record and `getFormat()` function provide the primary import surface for format translation:

```ts
import { getFormat } from '@proxitor/proxy-core/formats';

const adapter = getFormat('anthropic-messages');
const encoded = adapter.encodeRequest(ir);
```

## Testing

See `formats.test.ts` for cross-format golden tests that verify bidirectional translation behavior.
