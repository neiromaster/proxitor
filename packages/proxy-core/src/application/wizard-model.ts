// src/application/wizard-model.ts
import type { WireFormat } from '@proxitor/plugin-api';
import { type ProxyConfig, parseConfig } from './config-schema.js';

/** One provider as collected by the config wizard (spec §3.3, §6). */
export type WizardProvider = {
  readonly name: string;
  readonly wireFormat: WireFormat;
  readonly baseUrl: string;
  readonly authType: 'bearer' | 'x-api-key';
  readonly envVar: string;
};

/** One routing entry as collected by the wizard (spec §5.2). */
export type WizardModel = {
  readonly match: string;
  readonly provider: string;
  readonly modelId: string;
};

/** Everything the wizard collects before synthesis. */
export type WizardAnswers = {
  readonly providers: readonly WizardProvider[];
  readonly models: readonly WizardModel[];
  readonly defaultProvider: string;
  readonly host: string;
  readonly port: number;
};

/** Pure answers → minimal §6 config object (what gets serialized to YAML). */
export function wizardConfigObject(answers: WizardAnswers): unknown {
  const providers: Record<string, unknown> = {};
  for (const provider of answers.providers) {
    providers[provider.name] = {
      baseUrl: provider.baseUrl,
      wireFormat: provider.wireFormat,
      auth: { type: provider.authType, credential: { env: provider.envVar } },
    };
  }
  return {
    version: 1,
    providers,
    models: answers.models.map(model => ({
      match: model.match,
      provider: model.provider,
      modelId: model.modelId,
    })),
    defaultProvider: answers.defaultProvider,
    server: { host: answers.host, port: answers.port },
  };
}

/** Answers → schema-validated config. Throws ConfigError on invalid input. */
export function buildWizardConfig(answers: WizardAnswers): ProxyConfig {
  return parseConfig(wizardConfigObject(answers));
}
