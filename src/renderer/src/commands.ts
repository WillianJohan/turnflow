import { isShortcutCode } from '../../shared/uiFile'

// Registro único da paleta, do modal de atalhos e do teclado (E6.5).

export type CommandId =
  | 'search'
  | 'new'
  | 'newTab'
  | 'split'
  | 'closeTab'
  | 'sidebar'
  | 'copy'
  | 'paste'
  | 'draft'
  | 'sync'
  | 'shortcuts'
  | 'panel-prev'
  | 'panel-next'
  | 'cycle-prev'
  | 'cycle-next'
  | 'tab-1'
  | 'tab-2'
  | 'tab-3'
  | 'tab-4'
  | 'tab-5'
  | 'tab-6'
  | 'tab-7'
  | 'tab-8'
  | 'tab-9'
  | 'assistant'
  | 'hub'
  | 'talk'

export type CommandDef = {
  id: CommandId
  label: string
  code: string | null
  enabled: boolean
}

const tab = (n: number): CommandDef => ({
  id: `tab-${n}` as CommandId,
  label: `Tab ${n}`,
  code: `Digit${n}`,
  enabled: true
})

export const COMMANDS: CommandDef[] = [
  { id: 'search', label: 'Search', code: 'KeyK', enabled: true },
  { id: 'new', label: 'New', code: 'KeyN', enabled: true },
  { id: 'newTab', label: 'New tab', code: 'KeyT', enabled: true },
  { id: 'split', label: 'Split', code: 'Backslash', enabled: true },
  { id: 'closeTab', label: 'Close tab', code: 'KeyW', enabled: true },
  { id: 'sidebar', label: 'Sidebar', code: 'KeyB', enabled: true },
  { id: 'copy', label: 'Copy', code: 'KeyC', enabled: true },
  { id: 'paste', label: 'Paste', code: 'KeyV', enabled: true },
  { id: 'draft', label: 'Draft', code: 'KeyD', enabled: true },
  { id: 'sync', label: 'Sync', code: 'KeyU', enabled: true },
  { id: 'shortcuts', label: 'Shortcuts', code: null, enabled: true },
  { id: 'panel-prev', label: 'Previous panel', code: 'ArrowLeft', enabled: true },
  { id: 'panel-next', label: 'Next panel', code: 'ArrowRight', enabled: true },
  { id: 'cycle-prev', label: 'Previous tab', code: 'PageUp', enabled: true },
  { id: 'cycle-next', label: 'Next tab', code: 'PageDown', enabled: true },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(tab),
  { id: 'assistant', label: 'Assistant', code: 'KeyA', enabled: false },
  { id: 'hub', label: 'Hub', code: 'KeyM', enabled: false },
  { id: 'talk', label: 'Talk', code: 'Space', enabled: false }
]

export function defaultBindings(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const command of COMMANDS) {
    if (command.enabled && command.code) map[command.id] = command.code
  }
  return map
}

/**
 * Parte do padrão e aplica só o que foi gravado. Comando desligado não entra. `''` gravado =
 * desvinculado (perdeu a tecla para outro comando) e continua assim depois de reabrir.
 */
export function activeBindings(saved: Record<string, string>): Record<string, string> {
  const next = defaultBindings()
  for (const [id, code] of Object.entries(saved)) {
    const command = COMMANDS.find((item) => item.id === id)
    if (!command?.enabled || !isShortcutCode(code)) continue
    if (code === '') {
      delete next[id]
      continue
    }
    for (const [other, bound] of Object.entries(next)) {
      if (bound === code && other !== id) delete next[other]
    }
    next[id] = code
  }
  return next
}

export function bindCommand(
  bindings: Record<string, string>,
  id: string,
  code: string
): Record<string, string> {
  const next = { ...bindings }
  for (const [other, bound] of Object.entries(next)) {
    if (bound === code) delete next[other]
  }
  next[id] = code
  return next
}

export function commandFor(bindings: Record<string, string>, code: string): string | null {
  const found = Object.entries(bindings).find(([, bound]) => bound === code)
  return found?.[0] ?? null
}

/** O que difere do padrão. Comando do padrão que ficou sem tecla grava `''`. */
export function shortcutOverrides(bindings: Record<string, string>): Record<string, string> {
  const base = defaultBindings()
  const out: Record<string, string> = {}
  for (const [id, code] of Object.entries(bindings)) {
    if (base[id] !== code) out[id] = code
  }
  for (const id of Object.keys(base)) {
    if (!(id in bindings)) out[id] = ''
  }
  return out
}
