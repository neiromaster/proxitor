// src/adapters/config-wizard.ts
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stringify } from 'yaml';
import {
  buildWizardConfig,
  type WizardAnswers,
  type WizardModel,
  type WizardProvider,
  wizardConfigObject,
} from '../application/wizard-model.js';
import { defaultWritePath, findShadowingHomeConfig } from './config-file.js';

export type PromptOption<T extends string> = {
  readonly value: T;
  readonly label: string;
};

/** Interactive prompt seam: the clack adapter implements it; tests script it. */
export type PromptPort = {
  text(
    message: string,
    options?: { default?: string; placeholder?: string },
  ): Promise<string | undefined>;
  select<T extends string>(
    message: string,
    options: readonly PromptOption<T>[],
  ): Promise<T | undefined>;
  confirm(message: string, initialValue?: boolean): Promise<boolean | undefined>;
  note(message: string, title?: string): void;
};

export type WizardIo = {
  readonly prompt: PromptPort;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  readonly defaultOutPath: string;
};

const FORMAT_DEFAULTS = {
  'openai-chat': { baseUrl: 'https://api.openai.com', envVar: 'OPENAI_API_KEY' },
  'anthropic-messages': {
    baseUrl: 'https://api.anthropic.com',
    envVar: 'ANTHROPIC_API_KEY',
  },
} as const;

const WIRE_FORMATS = [
  { value: 'openai-chat', label: 'OpenAI Chat Completions (/v1/chat/completions)' },
  { value: 'anthropic-messages', label: 'Anthropic Messages (/v1/messages)' },
] as const satisfies readonly PromptOption<string>[];

const AUTH_TYPES = [
  { value: 'bearer', label: 'Bearer (Authorization: Bearer …)' },
  { value: 'x-api-key', label: 'x-api-key (Anthropic-style header)' },
] as const satisfies readonly PromptOption<string>[];

export function serializeConfigYaml(configObject: unknown): string {
  return stringify(configObject);
}

/** Real-filesystem WizardIo: recursive mkdir, atomic tmp+rename write. */
export function createWizardIo(prompt: PromptPort, outPath: string): WizardIo {
  return {
    prompt,
    async exists(path) {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    async mkdir(path) {
      await mkdir(path, { recursive: true });
    },
    writeFile: (path, content) => writeFile(path, content, 'utf8'),
    rename: (from, to) => rename(from, to),
    defaultOutPath: outPath,
  };
}

async function askProvider(
  prompt: PromptPort,
  taken: readonly string[],
): Promise<WizardProvider | undefined> {
  let name: string;
  for (;;) {
    const answer = await prompt.text('Provider name (config key)', {
      placeholder: 'my-openai',
    });
    if (answer === undefined) return undefined;
    if (answer.length === 0) continue;
    if (taken.includes(answer)) {
      prompt.note(`"${answer}" is already used — pick another name`, 'duplicate');
      continue;
    }
    name = answer;
    break;
  }
  const wireFormat = await prompt.select('Wire format', WIRE_FORMATS);
  if (wireFormat === undefined) return undefined;
  const defaults = FORMAT_DEFAULTS[wireFormat];
  const baseUrl = await prompt.text('Provider base URL', { default: defaults.baseUrl });
  if (baseUrl === undefined) return undefined;
  const authType = await prompt.select('Auth type', AUTH_TYPES);
  if (authType === undefined) return undefined;
  const envVar = await prompt.text('API key environment variable', {
    default: defaults.envVar,
  });
  if (envVar === undefined) return undefined;
  return { name, wireFormat, baseUrl, authType, envVar };
}

async function askModel(
  prompt: PromptPort,
  providers: readonly WizardProvider[],
): Promise<WizardModel | undefined> {
  const provider = await prompt.select(
    'Route requests for provider',
    providers.map(p => ({ value: p.name, label: p.name })),
  );
  if (provider === undefined) return undefined;
  const match = await prompt.text('Model match pattern (* is the wildcard)', {
    placeholder: 'gpt-5*',
  });
  if (match === undefined) return undefined;
  const modelId = await prompt.text(
    'Physical model id ($MODEL passes the name through)',
    {
      placeholder: 'gpt-5',
    },
  );
  if (modelId === undefined) return undefined;
  return { match, provider, modelId };
}

async function collectProviders(
  prompt: PromptPort,
): Promise<WizardProvider[] | undefined> {
  const providers: WizardProvider[] = [];
  for (;;) {
    const provider = await askProvider(
      prompt,
      providers.map(p => p.name),
    );
    if (provider === undefined) return undefined;
    providers.push(provider);
    const more = await prompt.confirm('Add another provider?', false);
    if (more === undefined) return undefined;
    if (!more) break;
  }
  return providers;
}

async function collectModels(
  prompt: PromptPort,
  providers: readonly WizardProvider[],
): Promise<WizardModel[] | undefined> {
  const models: WizardModel[] = [];
  for (;;) {
    const model = await askModel(prompt, providers);
    if (model === undefined) return undefined;
    models.push(model);
    const more = await prompt.confirm('Add another model route?', false);
    if (more === undefined) return undefined;
    if (!more) break;
  }
  return models;
}

async function collectDefaultProvider(
  prompt: PromptPort,
  providers: readonly WizardProvider[],
): Promise<string | undefined> {
  if (providers.length === 1) {
    return providers[0]?.name;
  }
  return await prompt.select(
    'Default provider for model-less requests (embeddings etc.)',
    providers.map(p => ({ value: p.name, label: p.name })),
  );
}

async function collectHostPort(
  prompt: PromptPort,
): Promise<{ host: string; port: number } | undefined> {
  const host = await prompt.text('Listen host', { default: '127.0.0.1' });
  if (host === undefined) return undefined;

  for (;;) {
    const portText = await prompt.text('Listen port', { default: '8828' });
    if (portText === undefined) return undefined;
    const parsed = Number.parseInt(portText, 10);
    if (Number.isInteger(parsed)) {
      return { host, port: parsed };
    }
    prompt.note('Port must be an integer', 'invalid port');
  }
}

async function confirmAndWrite(
  options: { force?: boolean },
  io: WizardIo,
  yaml: string,
): Promise<boolean> {
  const out = io.defaultOutPath;
  const proceed = await io.prompt.confirm(`Write config to ${out}?`, true);
  if (proceed === undefined || proceed === false) {
    io.prompt.note('Nothing written', 'aborted');
    return true;
  }
  if (!options.force && (await io.exists(out))) {
    const overwrite = await io.prompt.confirm(
      `${out} already exists — overwrite?`,
      false,
    );
    if (overwrite === undefined || overwrite === false) {
      io.prompt.note(`left ${out} untouched`, 'aborted');
      return true;
    }
  }
  await io.mkdir(dirname(out));
  const tmp = `${out}.tmp`;
  await io.writeFile(tmp, yaml);
  await io.rename(tmp, out);
  io.prompt.note(`config written to ${out}`, 'done');

  // Check if the new config is shadowed by a home config
  if (out === defaultWritePath()) {
    const shadow = await findShadowingHomeConfig(io.exists);
    if (shadow !== undefined) {
      io.prompt.note(
        `${shadow} is read BEFORE the XDG config — edit or remove it, or your new file will be ignored`,
        'shadowed config',
      );
    }
  }
  return true;
}

export async function runWizard(
  options: { force?: boolean },
  io: WizardIo,
): Promise<number> {
  const CANCELLED = 130;
  io.prompt.note(
    'Generates a minimal v1 config. Plugins are not wizard-managed — hand-edit the file later.',
    'proxitor config wizard',
  );

  const providers = await collectProviders(io.prompt);
  if (providers === undefined) return CANCELLED;

  const models = await collectModels(io.prompt, providers);
  if (models === undefined) return CANCELLED;

  const defaultProvider = await collectDefaultProvider(io.prompt, providers);
  if (defaultProvider === undefined) return CANCELLED;

  const hostPort = await collectHostPort(io.prompt);
  if (hostPort === undefined) return CANCELLED;

  const answers: WizardAnswers = {
    providers,
    models,
    defaultProvider,
    host: hostPort.host,
    port: hostPort.port,
  };
  const configObject = wizardConfigObject(answers);
  buildWizardConfig(answers); // fail fast on synthesis before any write
  const yaml = serializeConfigYaml(configObject);
  io.prompt.note(yaml, 'preview');

  const done = await confirmAndWrite(options, io, yaml);
  return done ? 0 : CANCELLED;
}
