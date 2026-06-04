import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import * as clack from '@clack/prompts'
import { isCancel } from '@clack/prompts'
import { parseDocument, stringify } from 'yaml'
import { findConfigFile, getXdgConfigDir } from '../../config.js'

const DEFAULT_PORT = 8828
const DEFAULT_HOST = '0.0.0.0'

type SaveLocation = 'local' | 'user' | 'xdg'

function maskKey(key: string): string {
  if (key.length <= 11) return '****'
  return `${key.slice(0, 7)}...${key.slice(-4)}`
}

function resolveSavePath(location: SaveLocation): string {
  switch (location) {
    case 'local':
      return resolve('proxitor.config.yaml')
    case 'user':
      return join(homedir(), '.config', 'proxitor', 'config.yaml')
    case 'xdg':
      return join(getXdgConfigDir(), 'config.yaml')
  }
}

function getSaveLocationOptions(_existingPath?: string) {
  const opts: { value: SaveLocation; label: string; hint: string }[] = [
    { value: 'local', label: './proxitor.config.yaml', hint: 'Project directory' },
    { value: 'user', label: '~/.config/proxitor/config.yaml', hint: 'User config' },
  ]

  if (process.env.XDG_CONFIG_HOME) {
    opts.push({
      value: 'xdg',
      label: '$XDG_CONFIG_HOME/proxitor/config.yaml',
      hint: 'XDG config directory',
    })
  }

  return opts
}

function detectLocation(path: string): SaveLocation | undefined {
  const cwd = resolve('.')
  if (path.startsWith(cwd)) return 'local'
  const userDir = join(homedir(), '.config', 'proxitor')
  if (path.startsWith(userDir)) {
    const xdgDir = process.env.XDG_CONFIG_HOME
      ? join(process.env.XDG_CONFIG_HOME, 'proxitor')
      : null
    if (xdgDir && path.startsWith(xdgDir)) return 'xdg'
    return 'user'
  }
  return undefined
}

function buildYaml(
  apiKey: string,
  port: number,
  host: string,
  existingRaw?: string,
): string {
  if (existingRaw) {
    const doc = parseDocument(existingRaw)
    doc.set('openrouterKey', apiKey)
    doc.set('port', port)
    doc.set('host', host)
    return doc.toString()
  }

  return stringify({ openrouterKey: apiKey, port, host })
}

function readExistingConfig(path: string): {
  raw: string
  port: number
  host: string
  apiKey: string
} {
  const raw = readFileSync(path, 'utf-8')
  const parsed = parseDocument(raw).toJSON() as Record<string, unknown>
  return {
    raw,
    port: typeof parsed?.port === 'number' ? parsed.port : DEFAULT_PORT,
    host: typeof parsed?.host === 'string' ? parsed.host : DEFAULT_HOST,
    apiKey: typeof parsed?.openrouterKey === 'string' ? parsed.openrouterKey : '',
  }
}

async function askApiKey(currentKey: string): Promise<string | null> {
  if (currentKey) {
    clack.log.info(`Current key: ${maskKey(currentKey)}`)
  }
  const apiKey = await clack.text({
    message: 'OpenRouter API key',
    placeholder: 'sk-or-v1-...',
    initialValue: currentKey,
    validate: v => {
      if (!v?.trim()) return 'API key is required'
      return undefined
    },
  })
  if (isCancel(apiKey)) return null

  clack.note(
    'You can also set the OPENROUTER_API_KEY environment variable\nto avoid storing the key in the config file.',
    'Tip',
  )
  return apiKey as string
}

async function askPort(current: number): Promise<number | null> {
  const input = await clack.text({
    message: 'Proxy port',
    initialValue: String(current),
    placeholder: String(DEFAULT_PORT),
    validate: v => {
      if (!v?.trim()) return undefined
      const n = Number.parseInt(v, 10)
      if (Number.isNaN(n) || n < 1 || n > 65535) return 'Port must be 1–65535'
      return undefined
    },
  })
  if (isCancel(input)) return null
  return (input as string).trim() ? Number.parseInt(input as string, 10) : DEFAULT_PORT
}

async function askHost(current: string): Promise<string | null> {
  const host = await clack.select({
    message: 'Listen address',
    initialValue: current as '0.0.0.0' | '127.0.0.1',
    options: [
      { value: '0.0.0.0', label: 'All interfaces (0.0.0.0)', hint: 'Default' },
      { value: '127.0.0.1', label: 'Localhost only (127.0.0.1)', hint: 'More secure' },
    ],
  })
  if (isCancel(host)) return null
  return host as string
}

async function askSaveLocation(existingPath?: string): Promise<SaveLocation | null> {
  const options = getSaveLocationOptions(existingPath)
  const detected = existingPath ? detectLocation(existingPath) : undefined

  const location = await clack.select({
    message: 'Save config to',
    initialValue: detected ?? 'local',
    options,
  })
  if (isCancel(location)) return null
  return location as SaveLocation
}

export async function runWizard(): Promise<void> {
  clack.intro('Proxitor Setup Wizard')

  const existingPath = findConfigFile()
  let existingRaw: string | undefined
  let currentPort = DEFAULT_PORT
  let currentHost = DEFAULT_HOST
  let currentKey = ''

  if (existingPath) {
    clack.note(existingPath, 'Existing config found')

    const reconfigure = await clack.confirm({
      message: 'Reconfigure?',
      initialValue: true,
    })
    if (isCancel(reconfigure) || !reconfigure) {
      clack.outro('Using existing configuration')
      return
    }

    try {
      const existing = readExistingConfig(existingPath)
      existingRaw = existing.raw
      currentPort = existing.port
      currentHost = existing.host
      currentKey = existing.apiKey
    } catch {
      // use defaults
    }
  }

  const apiKey = await askApiKey(currentKey)
  if (apiKey === null) {
    clack.outro('Cancelled')
    return
  }

  const port = await askPort(currentPort)
  if (port === null) {
    clack.outro('Cancelled')
    return
  }

  const host = await askHost(currentHost)
  if (host === null) {
    clack.outro('Cancelled')
    return
  }

  const location = await askSaveLocation(existingPath ?? undefined)
  if (location === null) {
    clack.outro('Cancelled')
    return
  }

  const yaml = buildYaml(apiKey, port, host, existingRaw)
  clack.note(yaml, 'Preview')

  const save = await clack.confirm({
    message: 'Save this configuration?',
    initialValue: true,
  })
  if (isCancel(save) || !save) {
    clack.outro('Cancelled — no files written')
    return
  }

  const savePath = resolveSavePath(location)
  const dir = dirname(savePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(savePath, yaml, 'utf-8')

  clack.outro(`Config saved to ${savePath}`)
}
