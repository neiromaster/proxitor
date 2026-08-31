import type { ProxyPlugin } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../domain/index.js';
import { createRoutingTable } from '../domain/index.js';
import { createPluginManager } from './plugin-manager.js';
import {
  type PipelineDeps,
  type PipelineRequest,
  prepareUpstream,
} from './proxy-pipeline.js';

const ANTHROPIC_PROVIDER: ProviderConfig = {
  id: 'ant',
  baseUrl: 'https://ant.example.com',
  wireFormat: 'anthropic-messages',
  auth: { type: 'x-api-key', credential: 'sk-ant-test' },
  headers: { 'anthropic-version': '2023-06-01' },
};

const OPENAI_PROVIDER: ProviderConfig = {
  id: 'oai',
  baseUrl: 'https://oai.example.com',
  wireFormat: 'openai-chat',
  auth: { type: 'bearer', credential: { env: 'OAI_KEY' } },
};

function makeTable(plugins: readonly string[] = []) {
  return createRoutingTable({
    providers: { ant: ANTHROPIC_PROVIDER, oai: OPENAI_PROVIDER },
    models: [
      { match: 'claude-*', provider: 'ant', modelId: '$MODEL', plugins },
      { match: 'gpt-*', provider: 'oai', modelId: 'gpt-5-real' },
    ],
  });
}

const logger = {
  infos: [] as string[],
  warns: [] as string[],
  errors: [] as string[],
  debugs: [] as string[],
  info(message: string) {
    this.infos.push(message);
  },
  warn(message: string) {
    this.warns.push(message);
  },
  error(message: string) {
    this.errors.push(message);
  },
  debug(message: string) {
    this.debugs.push(message);
  },
};

function makeDeps(plugins: ReadonlyMap<string, ProxyPlugin> = new Map()): PipelineDeps {
  return {
    table: makeTable([...plugins.keys()]),
    manager: createPluginManager({ plugins, logger }),
    fetch: {
      fetch: async () => {
        throw new Error('upstream not under test');
      },
    },
    credentials: {
      resolve: (ref: unknown) => (typeof ref === 'string' ? ref : 'resolved-secret'),
    },
    logger,
    clock: { now: () => 0 },
    random: { uuid: () => 'req-1' },
  };
}

const ANTHROPIC_BODY = JSON.stringify({
  model: 'claude-sonnet-5',
  max_tokens: 64,
  stream: false,
  messages: [{ role: 'user', content: 'hi' }],
});

function anthropicRequest(body = ANTHROPIC_BODY): PipelineRequest {
  return { path: '/v1/messages', method: 'POST', headers: {}, body };
}

async function readBody(body: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of body) {
    text += chunk;
  }
  return text;
}

describe('prepareUpstream — pre-route errors', () => {
  it('renders an unknown path as a 404 in the openai error shape (D5)', async () => {
    // Arrange / Act
    const outcome = await prepareUpstream(
      { path: '/nope', method: 'POST', headers: {}, body: '' },
      makeDeps(),
    );
    // Assert
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') return;
    expect(outcome.response.status).toBe(404);
    expect(JSON.parse(await readBody(outcome.response.body))).toEqual({
      error: { message: expect.stringContaining('/nope'), type: 'routing_error' },
    });
  });

  it('renders /v1/responses as a 501 in the openai error shape', async () => {
    // Arrange / Act
    const outcome = await prepareUpstream(
      { path: '/v1/responses', method: 'POST', headers: {}, body: '{}' },
      makeDeps(),
    );
    // Assert
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') return;
    expect(outcome.response.status).toBe(501);
    expect(JSON.parse(await readBody(outcome.response.body)).error.type).toBe(
      'routing_error',
    );
  });

  it("renders a decode failure as a 400 in the client's (anthropic) error shape", async () => {
    // Arrange / Act
    const outcome = await prepareUpstream(anthropicRequest('not-json'), makeDeps());
    // Assert
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') return;
    expect(outcome.response.status).toBe(400);
    expect(JSON.parse(await readBody(outcome.response.body))).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: expect.any(String) },
    });
  });

  it("renders an unrouted model as a 400 in the client's error shape", async () => {
    // Arrange
    const body = JSON.stringify({
      ...JSON.parse(ANTHROPIC_BODY),
      model: 'unknown-model',
    });
    // Act
    const outcome = await prepareUpstream(anthropicRequest(body), makeDeps());
    // Assert
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') return;
    expect(outcome.response.status).toBe(400);
    expect(JSON.parse(await readBody(outcome.response.body)).error.message).toContain(
      'unknown-model',
    );
  });

  it('rejects params.n > 1 with a 400 before routing (D13)', async () => {
    // Arrange
    const body = JSON.stringify({
      model: 'gpt-5',
      max_tokens: 32,
      n: 2,
      stream: false,
      messages: [{ role: 'user', content: 'hi' }],
    });
    // Act
    const outcome = await prepareUpstream(
      { path: '/v1/chat/completions', method: 'POST', headers: {}, body },
      makeDeps(),
    );
    // Assert
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') return;
    expect(outcome.response.status).toBe(400);
    expect(JSON.parse(await readBody(outcome.response.body)).error.message).toContain(
      'n',
    );
  });
});

describe('prepareUpstream — routing and plugin chain', () => {
  it('returns a ready request with the resolved route and untouched logical model (D9)', async () => {
    // Arrange / Act
    const outcome = await prepareUpstream(anthropicRequest(), makeDeps());
    // Assert
    expect(outcome.kind).toBe('ready');
    if (outcome.kind !== 'ready') return;
    expect(outcome.ready.resolution.provider.id).toBe('ant');
    expect(outcome.ready.resolution.physicalModel).toBe('claude-sonnet-5'); // $MODEL passthrough
    expect(outcome.ready.ir.model.logical).toBe('claude-sonnet-5');
    expect(outcome.ready.active).toEqual([]);
    expect(outcome.ready.requestId).toBe('req-1');
  });

  it('chains onRequest transforms in effective order, each seeing the previous result', async () => {
    // Arrange
    const seenBySecond: string[] = [];
    const marker: ProxyPlugin = {
      name: 'marker',
      onRequest: (_ctx, ir) => ({ ...ir, system: [{ type: 'text', text: 'marked' }] }),
    };
    const observer: ProxyPlugin = {
      name: 'observer',
      onRequest: (_ctx, ir) => {
        seenBySecond.push(
          ir.system.map(block => ('text' in block ? block.text : '')).join(','),
        );
        return ir;
      },
    };
    // Act
    const outcome = await prepareUpstream(
      anthropicRequest(),
      makeDeps(
        new Map([
          ['marker', marker],
          ['observer', observer],
        ]),
      ),
    );
    // Assert
    expect(seenBySecond).toEqual(['marked']);
    expect(outcome.kind).toBe('ready');
    if (outcome.kind !== 'ready') return;
    expect(outcome.ready.ir.system).toEqual([{ type: 'text', text: 'marked' }]);
  });

  it('skips a failing onRequest plugin with a warning and continues the chain (spec §7)', async () => {
    // Arrange
    const ranAfter: string[] = [];
    const broken: ProxyPlugin = {
      name: 'broken',
      onRequest: () => {
        throw new Error('boom');
      },
    };
    const after: ProxyPlugin = {
      name: 'after',
      onRequest: (_ctx, ir) => {
        ranAfter.push('after');
        return ir;
      },
    };
    // Act
    const outcome = await prepareUpstream(
      anthropicRequest(),
      makeDeps(
        new Map([
          ['broken', broken],
          ['after', after],
        ]),
      ),
    );
    // Assert
    expect(ranAfter).toEqual(['after']);
    expect(logger.warns).toContain('plugin onRequest hook failed; skipping plugin');
    expect(outcome.kind).toBe('ready');
  });

  it('renders a ShortCircuit error without triggering onError (spec §7)', async () => {
    // Arrange
    let onErrorCalls = 0;
    const blocker: ProxyPlugin = {
      name: 'blocker',
      onRequest: () => ({
        shortCircuit: true,
        status: 418,
        headers: { 'x-extra': '1' },
        error: { type: 'teapot_error', message: 'short and stout', status: 418 },
      }),
      onError: () => {
        onErrorCalls += 1;
        throw new Error('must not run');
      },
    };
    // Act
    const outcome = await prepareUpstream(
      anthropicRequest(),
      makeDeps(new Map([['blocker', blocker]])),
    );
    // Assert
    expect(onErrorCalls).toBe(0);
    expect(outcome.kind).toBe('shortCircuit');
    if (outcome.kind !== 'shortCircuit') return;
    expect(outcome.response.status).toBe(418);
    expect(outcome.response.headers['x-extra']).toBe('1');
    expect(JSON.parse(await readBody(outcome.response.body))).toEqual({
      type: 'error',
      error: { type: 'teapot_error', message: 'short and stout' },
    });
  });

  it('renders ShortCircuit events as a buffered anthropic JSON response with the logical model (D9, D11)', async () => {
    // Arrange
    const blocker: ProxyPlugin = {
      name: 'blocker',
      onRequest: (_ctx, ir) => ({
        shortCircuit: true,
        status: 200,
        events: [
          { type: 'message_start', id: 'msg_mock', model: ir.model.logical },
          { type: 'content_block_start', index: 0, block: { type: 'text' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text', text: 'mocked' },
          },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', stopReason: 'end_turn' },
          { type: 'message_stop' },
        ],
      }),
    };
    // Act
    const outcome = await prepareUpstream(
      anthropicRequest(),
      makeDeps(new Map([['blocker', blocker]])),
    );
    // Assert
    expect(outcome.kind).toBe('shortCircuit');
    if (outcome.kind !== 'shortCircuit') return;
    expect(outcome.response.status).toBe(200);
    expect(outcome.response.headers['content-type']).toBe('application/json');
    const parsed = JSON.parse(await readBody(outcome.response.body)) as {
      model: string;
      content: Array<{ text?: string }>;
    };
    expect(parsed.model).toBe('claude-sonnet-5');
    expect(parsed.content[0]?.text).toBe('mocked');
  });

  it('renders ShortCircuit events as an SSE stream when the client asked to stream', async () => {
    // Arrange
    const body = JSON.stringify({ ...JSON.parse(ANTHROPIC_BODY), stream: true });
    const blocker: ProxyPlugin = {
      name: 'blocker',
      onRequest: () => ({
        shortCircuit: true,
        status: 200,
        events: [
          { type: 'message_start', id: 'msg_mock', model: 'claude-sonnet-5' },
          { type: 'content_block_start', index: 0, block: { type: 'text' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text', text: 'mocked' },
          },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', stopReason: 'end_turn' },
          { type: 'message_stop' },
        ],
      }),
    };
    // Act
    const outcome = await prepareUpstream(
      anthropicRequest(body),
      makeDeps(new Map([['blocker', blocker]])),
    );
    // Assert
    expect(outcome.kind).toBe('shortCircuit');
    if (outcome.kind !== 'shortCircuit') return;
    expect(outcome.response.headers['content-type']).toBe('text/event-stream');
    const text = await readBody(outcome.response.body);
    expect(text).toContain('"type":"message_start"');
    expect(text).toContain('"model":"claude-sonnet-5"');
  });

  it('renders unknown-plugin activation failures as a 500 plugin_config_error (D7)', async () => {
    // Arrange — the config lists a plugin the registry does not have
    const deps: PipelineDeps = {
      table: makeTable(['ghost']),
      manager: createPluginManager({ plugins: new Map(), logger }),
      fetch: {
        fetch: async () => {
          throw new Error('unreached');
        },
      },
      credentials: { resolve: () => 'x' },
      logger,
      clock: { now: () => 0 },
      random: { uuid: () => 'req-1' },
    };
    // Act
    const outcome = await prepareUpstream(anthropicRequest(), deps);
    // Assert
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') return;
    expect(outcome.response.status).toBe(500);
    expect(JSON.parse(await readBody(outcome.response.body)).error.type).toBe(
      'plugin_config_error',
    );
  });
});
