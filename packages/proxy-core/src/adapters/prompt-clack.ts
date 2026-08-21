import * as clack from '@clack/prompts';
import type { PromptPort } from './config-wizard.js';

/** clack-backed PromptPort. Cancel (ctrl-c/esc) maps to undefined. */
export function createClackPrompt(): PromptPort {
  return {
    async text(message: string, options?: { default?: string; placeholder?: string }) {
      const answer = await clack.text({
        message,
        defaultValue: options?.default,
        placeholder: options?.placeholder,
      });
      if (clack.isCancel(answer)) {
        return undefined;
      }
      return answer;
    },
    async select<T extends string>(
      message: string,
      options: readonly { value: T; label: string }[],
    ) {
      const answer = await clack.select({
        message,
        options: options.map(
          // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- clack type import
          (option): clack.Option<string> => ({
            value: option.value,
            label: option.label,
          }),
        ),
      });
      if (clack.isCancel(answer)) {
        return undefined;
      }
      // Guarded by isCancel check above; contract guarantees T is one of the option values
      return answer as T;
    },
    async confirm(message: string, initialValue?: boolean) {
      const answer = await clack.confirm({ message, initialValue });
      if (clack.isCancel(answer)) {
        return undefined;
      }
      return answer;
    },
    note(message: string, title?: string): void {
      clack.note(message, title);
    },
  };
}
