import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import type { OpenRouterDataClient } from '../openrouter/data-client.js';
import { addOverrideCommand } from './config/add.js';
import { browseModelsCommand } from './config/browse.js';
import { cacheControlCommand } from './config/cache-control.js';
import { connectionMenuCommand } from './config/connection.js';
import { editOverrideCommand } from './config/edit.js';
import { listOverridesCommand } from './config/list.js';
import { removeOverrideCommand } from './config/remove.js';
import { sessionRoutingCommand } from './config/session-routing.js';
import { showConfigCommand } from './config/show.js';
import { validateConfigCommand } from './config/validate.js';

export async function runConfigMenu(client: OpenRouterDataClient): Promise<void> {
  clack.intro('Proxitor Config Manager');

  while (true) {
    const action = await clack.select({
      message: 'What would you like to do?',
      options: [
        { value: 'show', label: '📋  Show current config' },
        { value: '_sep1', label: '── Global Settings ──', disabled: true },
        { value: 'connection', label: '🔑  API key & connection' },
        { value: 'session', label: '🔗  Session routing' },
        { value: 'cache', label: '💾  Cache control' },
        { value: '_sep2', label: '── Model Overrides ──', disabled: true },
        { value: 'add', label: '➕  Add model override' },
        { value: 'edit', label: '✏️   Edit model override' },
        { value: 'remove', label: '🗑   Remove model override' },
        { value: 'list', label: '📄  List current overrides' },
        { value: 'browse', label: '🔍  Browse models' },
        { value: '_sep3', label: '── Tools ──', disabled: true },
        { value: 'validate', label: '✅  Validate config' },
        { value: 'exit', label: '❌  Exit' },
      ],
    });

    if (isCancel(action) || action === 'exit') {
      clack.outro('Bye!');
      return;
    }

    switch (action) {
      case 'show':
        await showConfigCommand({});
        break;
      case 'connection':
        await connectionMenuCommand();
        break;
      case 'session':
        await sessionRoutingCommand();
        break;
      case 'cache':
        await cacheControlCommand();
        break;
      case 'add':
        await addOverrideCommand({ client });
        break;
      case 'edit':
        await editOverrideCommand(client);
        break;
      case 'remove':
        await removeOverrideCommand();
        break;
      case 'list':
        await listOverridesCommand();
        break;
      case 'browse':
        await browseModelsCommand(client);
        break;
      case 'validate':
        await validateConfigCommand();
        break;
    }
  }
}
