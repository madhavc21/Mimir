/** DOM KeyboardEvent.code values that are modifiers only — not the main key. */
const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
])

const NAMED_CODES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
}

/** Map W3C `KeyboardEvent.code` to tauri-plugin-global-shortcut key names. */
export function codeToHotkeyKey(code: string): string | null {
  if (MODIFIER_CODES.has(code)) return null
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return code
  return NAMED_CODES[code] ?? null
}

/**
 * Build a shortcut string from a captured keydown.
 * Requires at least one modifier — global shortcuts use RegisterHotKey, not bare keys.
 */
export function formatRecordedHotkey(e: KeyboardEvent): string | null {
  const key = codeToHotkeyKey(e.code)
  if (!key) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  if (e.metaKey) parts.push('Meta')
  if (parts.length === 0) return null

  parts.push(key)
  return parts.join('+')
}
