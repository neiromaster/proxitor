// src/adapters/config-wizard.test.ts
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseConfig } from '../application/config-schema.js';
import {
  createWizardIo,
  type PromptOption,
  type PromptPort,
  runWizard,
  serializeConfigYaml,
  type WizardIo,
} from './config-wizard.js';

/** Scripted prompt: answers are consumed in order; every call is recorded. */
type Step =
  | { kind: 'text'; answer: string }
  | { kind: 'select'; answer: string }
  | { kind: 'confirm'; answer: boolean }
  | { kind: 'cancel' };

function scriptedPrompt(steps: Step[]) {
  const calls: {
    kind: string;
    message: string;
    options?: { default?: string; placeholder?: string };
  }[] = [];
  const notes: string[] = [];
  const take = (): Step => {
    const step = steps.shift();
    if (step === undefined) throw new Error('scripted prompt exhausted');
    return step;
  };
  const prompt: PromptPort = {
    async text(message, options) {
      calls.push({ kind: 'text', message, options });
      const step = take();
      return step.kind === 'text' ? step.answer : undefined;
    },
    async select(message, _options: readonly PromptOption<string>[]) {
      calls.push({ kind: 'select', message });
      const step = take();
      return step.kind === 'select' ? (step.answer as never) : undefined;
    },
    async confirm(message) {
      calls.push({ kind: 'confirm', message });
      const step = take();
      return step.kind === 'confirm' ? step.answer : undefined;
    },
    note(message, title) {
      notes.push(`${title ?? ''}: ${message}`);
    },
  };
  return { prompt, calls, notes };
}

function fakeIo(
  prompt: PromptPort,
  outPath: string,
  existingPaths: string[] = [],
): WizardIo & { writes: Map<string, string> } {
  const writes = new Map<string, string>();
  const existing = new Set(existingPaths);
  const io: WizardIo = {
    prompt,
    async exists(path) {
      return existing.has(path);
    },
    async mkdir() {},
    async writeFile(path, content) {
      writes.set(path, content);
    },
    async rename(from, to) {
      const content = writes.get(from);
      if (content === undefined) throw new Error(`rename: no tmp at ${from}`);
      writes.delete(from);
      writes.set(to, content);
    },
    defaultOutPath: outPath,
  };
  return { ...io, writes };
}

// A minimal happy-path script: 1 provider, 1 model, auto defaultProvider.
const HAPPY: Step[] = [
  { kind: 'text', answer: 'openai' }, // provider name
  { kind: 'select', answer: 'openai-chat' }, // wireFormat
  { kind: 'text', answer: 'https://api.openai.com' }, // baseUrl
  { kind: 'select', answer: 'bearer' }, // authType
  { kind: 'text', answer: 'OPENAI_API_KEY' }, // envVar
  { kind: 'confirm', answer: false }, // add another provider? no
  { kind: 'select', answer: 'openai' }, // model: provider pick
  { kind: 'text', answer: 'gpt-5' }, // model: match
  { kind: 'text', answer: 'gpt-5' }, // model: modelId
  { kind: 'confirm', answer: false }, // add another model? no
  { kind: 'text', answer: '127.0.0.1' }, // host
  { kind: 'text', answer: '8828' }, // port
  { kind: 'confirm', answer: true }, // write it?
];

describe('runWizard', () => {
  it('writes a parseable minimal config atomically (tmp + rename)', async () => {
    const { prompt, notes } = scriptedPrompt([...HAPPY]);
    const out = '/tmp/proxitor-wizard/config.yaml';
    const io = fakeIo(prompt, out);
    const code = await runWizard({}, io);
    expect(code).toBe(0);
    const yaml = io.writes.get(out);
    expect(yaml).toBeDefined();
    const config = parseConfig(parseYaml(yaml ?? ''));
    expect(config.providers.openai?.auth.credential).toEqual({ env: 'OPENAI_API_KEY' });
    expect(config.models).toEqual([
      { match: 'gpt-5', provider: 'openai', modelId: 'gpt-5' },
    ]);
    expect(io.writes.has(`${out}.tmp`)).toBe(false); // renamed away
    expect(notes.some(note => note.includes('written'))).toBe(true);
  });

  it('prompts with the documented defaults (host 127.0.0.1, port 8828, per-format baseUrl/env)', async () => {
    const { prompt, calls } = scriptedPrompt([...HAPPY]);
    await runWizard({}, fakeIo(prompt, '/tmp/out.yaml'));
    const byMessage = (fragment: string) =>
      calls.find(call => call.message.includes(fragment));
    expect(byMessage('base URL')?.options?.default).toBe('https://api.openai.com');
    expect(byMessage('API key environment variable')?.options?.default).toBe(
      'OPENAI_API_KEY',
    );
    expect(byMessage('Listen host')?.options?.default).toBe('127.0.0.1');
    expect(byMessage('Listen port')?.options?.default).toBe('8828');
  });

  it('returns 130 and writes nothing on cancel at the first prompt', async () => {
    const { prompt } = scriptedPrompt([{ kind: 'cancel' }]);
    const io = fakeIo(prompt, '/tmp/out.yaml');
    const code = await runWizard({}, io);
    expect(code).toBe(130);
    expect(io.writes.size).toBe(0);
  });

  it('skips the defaultProvider prompt when there is exactly one provider', async () => {
    const { prompt, calls } = scriptedPrompt([...HAPPY]);
    await runWizard({}, fakeIo(prompt, '/tmp/out.yaml'));
    expect(calls.some(call => call.message.includes('model-less'))).toBe(false);
  });

  it('re-asks a duplicate provider name instead of accepting it', async () => {
    const script: Step[] = [
      { kind: 'text', answer: 'openai' },
      { kind: 'select', answer: 'openai-chat' },
      { kind: 'text', answer: 'https://api.openai.com' },
      { kind: 'select', answer: 'bearer' },
      { kind: 'text', answer: 'OPENAI_API_KEY' },
      { kind: 'confirm', answer: true }, // another provider
      { kind: 'text', answer: 'openai' }, // duplicate name
      { kind: 'text', answer: 'backup' }, // corrected name
      { kind: 'select', answer: 'openai-chat' },
      { kind: 'text', answer: 'https://api.openai.com' },
      { kind: 'select', answer: 'bearer' },
      { kind: 'text', answer: 'OPENAI_API_KEY' },
      { kind: 'confirm', answer: false },
      { kind: 'select', answer: 'openai' },
      { kind: 'text', answer: 'gpt-5' },
      { kind: 'text', answer: 'gpt-5' },
      { kind: 'confirm', answer: false },
      { kind: 'select', answer: 'openai' }, // defaultProvider (2 providers → asked)
      { kind: 'text', answer: '127.0.0.1' },
      { kind: 'text', answer: '8828' },
      { kind: 'confirm', answer: true },
    ];
    const { prompt, notes } = scriptedPrompt(script);
    const io = fakeIo(prompt, '/tmp/out.yaml');
    expect(await runWizard({}, io)).toBe(0);
    const config = parseConfig(parseYaml(io.writes.get('/tmp/out.yaml') ?? ''));
    expect(Object.keys(config.providers)).toEqual(['openai', 'backup']);
    expect(notes.some(note => note.includes('already used'))).toBe(true);
  });

  it('leaves an existing file untouched when overwrite is declined', async () => {
    const { prompt } = scriptedPrompt([...HAPPY, { kind: 'confirm', answer: false }]);
    // note: HAPPY ends with the write confirm; the extra step answers the
    // overwrite confirm because the target already exists.
    const io = fakeIo(prompt, '/tmp/out.yaml', ['/tmp/out.yaml']);
    const code = await runWizard({}, io);
    expect(code).toBe(0);
    expect(io.writes.get('/tmp/out.yaml')).toBeUndefined();
  });

  it('force skips the overwrite confirmation', async () => {
    const { prompt } = scriptedPrompt([...HAPPY]);
    const io = fakeIo(prompt, '/tmp/out.yaml', ['/tmp/out.yaml']);
    expect(await runWizard({ force: true }, io)).toBe(0);
    const config = parseConfig(parseYaml(io.writes.get('/tmp/out.yaml') ?? ''));
    expect(config.providers.openai).toBeDefined();
  });

  it('createWizardIo writes a real file through tmp+rename', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'proxitor-wizard-'));
    const out = join(dir, 'nested', 'config.yaml');
    const { prompt } = scriptedPrompt([...HAPPY]);
    const io = createWizardIo(prompt, out);
    expect(await runWizard({}, io)).toBe(0);
    const text = await readFile(out, 'utf8');
    expect(parseConfig(parseYaml(text)).version).toBe(1);
    const entries = await readdir(join(dir, 'nested'));
    expect(entries).toEqual(['config.yaml']); // no tmp left behind
  });

  it('shows shadow note when output is default XDG path and home config exists', async () => {
    const { prompt, notes } = scriptedPrompt([...HAPPY]);
    const homeDir = process.env.HOME ?? '/';
    // Use a path that matches HOME_CANDIDATES
    const homeConfigPath = join(homeDir, '.proxitor.yaml');
    // Use default XDG path as output
    const xdgPath = join(homeDir, '.config', 'proxitor', 'config.yaml');
    const io = fakeIo(prompt, xdgPath, [homeConfigPath]);
    expect(await runWizard({}, io)).toBe(0);
    // Should have shadow note
    expect(notes.some(note => note.includes('shadowed config'))).toBe(true);
    expect(notes.some(note => note.includes('read BEFORE the XDG config'))).toBe(true);
  });

  it('does NOT show shadow note when output is not default XDG path', async () => {
    const { prompt, notes } = scriptedPrompt([...HAPPY]);
    const homeDir = process.env.HOME ?? '/';
    const homeConfigPath = join(homeDir, '.proxitor.yaml');
    const io = fakeIo(prompt, '/custom/path/config.yaml', [homeConfigPath]);
    // Even with home config present, custom path should not trigger shadow note
    expect(await runWizard({}, io)).toBe(0);
    // Should NOT have shadow note
    expect(notes.some(note => note.includes('shadowed config'))).toBe(false);
  });

  it('does NOT show shadow note when no home config exists', async () => {
    const { prompt, notes } = scriptedPrompt([...HAPPY]);
    const io = fakeIo(prompt, '/xdg/config.yaml');
    // No home config
    expect(await runWizard({}, io)).toBe(0);
    // Should NOT have shadow note
    expect(notes.some(note => note.includes('shadowed config'))).toBe(false);
  });
});

describe('serializeConfigYaml', () => {
  it('produces YAML text', () => {
    expect(serializeConfigYaml({ version: 1 })).toBe('version: 1\n');
  });
});
