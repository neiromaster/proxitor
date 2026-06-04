import * as clack from '@clack/prompts'
import { isCancel } from '@clack/prompts'
import { addOverrideCommand } from './config/add.js'
import { browseModelsCommand } from './config/browse.js'
import { editOverrideCommand } from './config/edit.js'
import { listOverridesCommand } from './config/list.js'
import { removeOverrideCommand } from './config/remove.js'
import { validateConfigCommand } from './config/validate.js'

/** Run the interactive config manager menu. */
export async function runConfigMenu(apiKey: string): Promise<void> {
  clack.intro('Proxitor Config Manager')

  const action = await clack.select({
    message: 'What would you like to do?',
    options: [
      { value: 'add', label: '➕  Add model override' },
      { value: 'edit', label: '✏️   Edit model override' },
      { value: 'remove', label: '🗑   Remove model override' },
      { value: 'list', label: '📋  List current overrides' },
      { value: 'browse', label: '🔍  Browse models' },
      { value: 'validate', label: '✅  Validate config' },
      { value: 'exit', label: '❌  Exit' },
    ],
  })

  if (isCancel(action) || action === 'exit') {
    clack.outro('Bye!')
    return
  }

  switch (action) {
    case 'add':
      await addOverrideCommand(apiKey)
      break
    case 'edit':
      await editOverrideCommand(apiKey)
      break
    case 'remove':
      await removeOverrideCommand()
      break
    case 'list':
      await listOverridesCommand()
      break
    case 'browse':
      await browseModelsCommand(apiKey)
      break
    case 'validate':
      await validateConfigCommand()
      break
  }
}
