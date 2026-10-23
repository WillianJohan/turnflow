export type AppCmd =
  | 'search'
  | 'split'
  | 'closeTab'
  | 'sidebar'
  | 'copy'
  | 'paste'
  | 'draft'
  | 'newTab'
  | { tab: number }
  | { panel: -1 | 1 }
  | { cycle: -1 | 1 }

type Key = { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; key: string; code: string }

// Pelo `code` (tecla física): `key` muda com Shift e com o layout ABNT.
const BY_CODE: Record<string, AppCmd> = {
  KeyK: 'search',
  Backslash: 'split',
  IntlBackslash: 'split',
  KeyW: 'closeTab',
  KeyB: 'sidebar',
  KeyC: 'copy',
  KeyV: 'paste',
  KeyD: 'draft',
  KeyT: 'newTab',
  ArrowLeft: { panel: -1 },
  ArrowRight: { panel: 1 },
  PageUp: { cycle: -1 },
  PageDown: { cycle: 1 }
}

// Só Ctrl+Shift (sem Alt) é do app; todo o resto vai pro terminal.
export function appCommand(e: Key): AppCmd | null {
  if (!e.ctrlKey || !e.shiftKey || e.altKey) return null
  const d = e.code.match(/^Digit([1-9])$/)
  if (d) return { tab: Number(d[1]) }
  return BY_CODE[e.code] ?? null
}

export type TermCmd = 'copy' | 'paste' | 'newline'

// Teclas que o app trata dentro do terminal, sem Shift+Ctrl (esses são do appCommand).
// Ctrl+C só copia se houver seleção; sem seleção segue pro claude como interrupção.
export function termKey(e: Key, hasSelection: boolean): TermCmd | null {
  if (e.altKey) return null
  if (e.ctrlKey && !e.shiftKey && e.code === 'KeyC') return hasSelection ? 'copy' : null
  if (e.ctrlKey && !e.shiftKey && e.code === 'KeyV') return 'paste'
  if (!e.ctrlKey && e.shiftKey && e.key === 'Enter') return 'newline'
  return null
}
