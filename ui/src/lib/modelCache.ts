import type { ModelInfo } from '@/lib/settings'

const TTL_MS = 10 * 60 * 1000
const MAX_ENTRIES = 10

type CacheEntry = {
  models: ModelInfo[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

/** ponytail: provider + key fingerprint — not crypto, just avoids cross-key bleed */
export function modelCacheKey(provider: string, apiKey: string): string {
  const k = apiKey.trim()
  const tail = k.length > 8 ? k.slice(-8) : k
  return `${provider}:${k.length}:${tail}`
}

export function getModelCache(key: string): { models: ModelInfo[]; fresh: boolean } | null {
  const entry = cache.get(key)
  if (!entry) return null
  const fresh = Date.now() - entry.fetchedAt < TTL_MS
  return { models: entry.models, fresh }
}

export function setModelCache(key: string, models: ModelInfo[]): void {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, { models, fetchedAt: Date.now() })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
}
