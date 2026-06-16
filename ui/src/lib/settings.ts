import { load } from '@tauri-apps/plugin-store'

export interface AppSettings {
  geminiApiKey: string
  geminiModel: string
  autostart: boolean
  hotkey: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash-lite',
  autostart: true,
  hotkey: 'Ctrl+Shift+E',
}

export const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
] as const

const STORE_FILE = 'settings.json'

async function getStore() {
  return load(STORE_FILE, { autoSave: true, defaults: {} })
}

export async function loadSettings(): Promise<AppSettings> {
  const store = await getStore()
  const geminiApiKey = (await store.get<string>('geminiApiKey')) ?? DEFAULT_SETTINGS.geminiApiKey
  const geminiModel = (await store.get<string>('geminiModel')) ?? DEFAULT_SETTINGS.geminiModel
  const autostart = (await store.get<boolean>('autostart')) ?? DEFAULT_SETTINGS.autostart
  const hotkey = (await store.get<string>('hotkey')) ?? DEFAULT_SETTINGS.hotkey
  return { geminiApiKey, geminiModel, autostart, hotkey }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const store = await getStore()
  const current = await loadSettings()
  const next = { ...current, ...patch }
  if (patch.geminiApiKey !== undefined) await store.set('geminiApiKey', next.geminiApiKey)
  if (patch.geminiModel !== undefined) await store.set('geminiModel', next.geminiModel)
  if (patch.autostart !== undefined) await store.set('autostart', next.autostart)
  if (patch.hotkey !== undefined) await store.set('hotkey', next.hotkey)
  return next
}
