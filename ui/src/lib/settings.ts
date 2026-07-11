import { load } from '@tauri-apps/plugin-store'

export type HotkeyOpens = 'new' | 'latest'

export interface ModelInfo {
  id: string
  supportsVision: boolean
}

export interface AppSettings {
  apiKey: string
  /** LiteLLM provider id, e.g. "gemini", "bedrock", "cohere" */
  selectedProvider: string | null
  selectedModel: string
  autostart: boolean
  hotkey: string
  hotkeyOpens: HotkeyOpens
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  selectedProvider: null,
  selectedModel: 'gemini/gemini-2.5-flash-lite',
  autostart: true,
  hotkey: 'Ctrl+Shift+E',
  hotkeyOpens: 'new',
}

/** Hint only — user can pick any provider from LiteLLM catalog manually. */
export function detectProviderFromApiKey(key: string): string | null {
  const k = key.trim()
  if (!k) return null
  if (k.startsWith('sk-ant-')) return 'anthropic'
  if (k.startsWith('AIza')) return 'gemini'
  if (k.startsWith('xai-')) return 'xai'
  if (k.startsWith('sk-')) return 'openai'
  return null
}

export function formatProviderLabel(id: string): string {
  return id.replace(/_/g, ' ')
}

const STORE_FILE = 'settings.json'

async function getStore() {
  return load(STORE_FILE, { autoSave: true, defaults: {} })
}

export async function loadSettings(): Promise<AppSettings> {
  const store = await getStore()
  try {
    await store.reload()
  } catch {
    // ponytail: fresh install — no settings.json yet
  }
  const apiKey = (await store.get<string>('apiKey')) ?? DEFAULT_SETTINGS.apiKey
  const selectedProvider =
    (await store.get<string | null>('selectedProvider')) ?? DEFAULT_SETTINGS.selectedProvider
  const selectedModel =
    (await store.get<string>('selectedModel')) ?? DEFAULT_SETTINGS.selectedModel
  const autostart = (await store.get<boolean>('autostart')) ?? DEFAULT_SETTINGS.autostart
  const hotkey = (await store.get<string>('hotkey')) ?? DEFAULT_SETTINGS.hotkey
  const hotkeyOpens =
    (await store.get<HotkeyOpens>('hotkeyOpens')) ?? DEFAULT_SETTINGS.hotkeyOpens
  return { apiKey, selectedProvider, selectedModel, autostart, hotkey, hotkeyOpens }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const store = await getStore()
  const current = await loadSettings()
  const next = { ...current, ...patch }
  if (patch.apiKey !== undefined) await store.set('apiKey', next.apiKey)
  if (patch.selectedProvider !== undefined) await store.set('selectedProvider', next.selectedProvider)
  if (patch.selectedModel !== undefined) await store.set('selectedModel', next.selectedModel)
  if (patch.autostart !== undefined) await store.set('autostart', next.autostart)
  if (patch.hotkey !== undefined) await store.set('hotkey', next.hotkey)
  if (patch.hotkeyOpens !== undefined) await store.set('hotkeyOpens', next.hotkeyOpens)
  await store.save()
  return next
}

export async function listProviders(): Promise<string[]> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string[]>('list_providers')
}

export async function listModels(provider?: string | null): Promise<ModelInfo[]> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<ModelInfo[]>('list_models', { provider: provider ?? null })
}
