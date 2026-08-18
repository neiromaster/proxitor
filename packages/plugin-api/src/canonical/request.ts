/** Per-node passthrough for fields the IR does not model (spec §4.1, D17). */
export type NodeExtensions = Record<string, unknown>;

/** Request-level passthrough bag keyed by source format (spec §4.3). */
export type ExtensionsBag = Record<string, Record<string, unknown>>;

export type CacheControl = { type: 'ephemeral'; ttl?: '5m' | '1h' };

export type CanonicalSystemBlock = {
  type: 'text';
  text: string;
  cacheControl?: CacheControl;
  extensions?: NodeExtensions;
};

export type ImageSource =
  | { kind: 'base64'; mediaType: string; data: string }
  | { kind: 'url'; url: string };

export type ResponseFormat =
  | { kind: 'json' }
  | { kind: 'json_schema'; schema: Record<string, unknown> };

export type CanonicalContentBlock =
  | {
      type: 'text';
      text: string;
      cacheControl?: CacheControl;
      extensions?: NodeExtensions;
    }
  | {
      type: 'image';
      source: ImageSource;
      cacheControl?: CacheControl;
      extensions?: NodeExtensions;
    }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: unknown;
      cacheControl?: CacheControl;
      extensions?: NodeExtensions;
    }
  | {
      type: 'tool_result';
      toolUseId: string;
      content: CanonicalContentBlock[] | string;
      isError?: boolean;
      cacheControl?: CacheControl;
      extensions?: NodeExtensions;
    }
  | {
      type: 'thinking';
      thinking: string;
      signature?: string;
      cacheControl?: CacheControl;
      extensions?: NodeExtensions;
    };

export type CanonicalMessage = {
  role: 'user' | 'assistant';
  content: CanonicalContentBlock[];
  extensions?: NodeExtensions;
};

export type CanonicalTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  cacheControl?: CacheControl;
};

export type CanonicalToolChoice =
  | { mode: 'auto' | 'any' | 'none' }
  | { mode: 'tool'; name: string };

/** Provenance-preserving max tokens (r2 P0-1): same-format encode re-emits the source field name. */
export type MaxTokens = {
  value: number;
  source: 'max_tokens' | 'max_completion_tokens' | 'max_output_tokens';
};

export type CanonicalParams = {
  temperature?: number;
  maxTokens?: MaxTokens;
  topP?: number;
  topK?: number;
  stop?: string[];
  seed?: number;
  n?: number;
  responseFormat?: ResponseFormat;
  presencePenalty?: number;
  frequencyPenalty?: number;
};

export type CanonicalRequest = {
  model: { logical: string; physical: string };
  system: CanonicalSystemBlock[];
  messages: CanonicalMessage[];
  tools?: CanonicalTool[];
  toolChoice?: CanonicalToolChoice;
  params: CanonicalParams;
  stream: boolean;
  extensions: ExtensionsBag;
  /** Plugin → upstream header channel (D18); auth + provider.headers are protected. */
  outboundHeaders?: Record<string, string>;
};
