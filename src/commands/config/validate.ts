import * as clack from '@clack/prompts';
import {
  ConfigValidationError,
  readConfigFile,
  tryFindConfigFile,
} from '../../config.js';

type ValidateArgs = { json?: boolean | undefined };

type ValidateResult =
  | { ok: true; configPath: string; keyCount: number; overrideCount: number }
  | {
      ok: false;
      configPath: string | null;
      error: string;
      issues?: Array<{ path: string; message: string }>;
    };

/** Validate a config file and return a structured result. */
function validate(configPath: string | null): ValidateResult {
  if (!configPath) {
    return { ok: false, configPath: null, error: 'No config file found' };
  }
  try {
    const cfg = readConfigFile(configPath);
    return {
      ok: true,
      configPath,
      keyCount: Object.keys(cfg).length,
      overrideCount: cfg.modelOverrides ? Object.keys(cfg.modelOverrides).length : 0,
    };
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      const issues = error.message
        .split('\n')
        .filter(line => line.startsWith('  '))
        .map(line => {
          const colonIdx = line.indexOf(':');
          if (colonIdx === -1) return { path: '(unknown)', message: line.trim() };
          return {
            path: line.slice(0, colonIdx).trim(),
            message: line.slice(colonIdx + 1).trim(),
          };
        });
      return { ok: false, configPath, error: error.message, issues };
    }
    return {
      ok: false,
      configPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Run config validation and display results. */
export async function validateConfigCommand(args: ValidateArgs = {}): Promise<number> {
  const configPath = tryFindConfigFile();
  const result = validate(configPath);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }

  clack.intro('Validate Config');

  if (result.ok) {
    clack.log.success(`Config is valid: ${result.configPath}`);
    clack.log.info(
      `  ${result.keyCount} top-level keys, ${result.overrideCount} model override(s)`,
    );
    clack.outro('Ready to run `proxitor start`.');
    return 0;
  }

  // Failure path
  if (!result.configPath) {
    clack.log.warn('No config file found — nothing to validate.');
    clack.log.info('Searched:');
    // tryFindConfigFile already logged this; keep message terse in text mode.
    clack.outro('Run `proxitor config wizard` to create one.');
    return 1;
  }

  clack.log.error(`Invalid config: ${result.configPath}`);
  if (result.issues && result.issues.length > 0) {
    clack.note(
      result.issues.map(i => `  ${i.path}: ${i.message}`).join('\n'),
      'Validation issues',
    );
    clack.log.info('Tips:');
    clack.log.info(`  • Open the file: \`$EDITOR ${result.configPath}\``);
    clack.log.info('  • Run `proxitor config wizard` to start fresh');
    clack.log.info('  • Or run `proxitor doctor` for a fuller diagnostic');
  } else {
    clack.log.error(result.error);
  }
  clack.outro('Fix the issues and re-run `proxitor config validate`.');
  return 1;
}
