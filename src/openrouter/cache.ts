import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type CacheEntry<T> = {
  data: T
  fetchedAt: number
}

export const CACHE_DIR = join(homedir(), '.cache', 'proxitor')

/** Read a cached value. Returns `null` when missing, expired (older than `ttlMs`), or unparseable. */
export function readCache<T>(key: string, ttlMs: number): T | null {
  const path = join(CACHE_DIR, `${key}.json`)
  if (!existsSync(path)) return null

  try {
    const entry: CacheEntry<T> = JSON.parse(readFileSync(path, 'utf-8'))
    if (Date.now() - entry.fetchedAt > ttlMs) return null
    return entry.data
  } catch {
    return null
  }
}

export function writeCache<T>(key: string, data: T): void {
  mkdirSync(CACHE_DIR, { recursive: true })
  const entry: CacheEntry<T> = { fetchedAt: Date.now(), data }
  writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify(entry))
}

export function clearCache(key: string): void {
  const path = join(CACHE_DIR, `${key}.json`)
  if (existsSync(path)) unlinkSync(path)
}
