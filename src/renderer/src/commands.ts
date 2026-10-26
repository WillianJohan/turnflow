import { SHELL_COPY } from '../../shared/copy/shell'
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

const C = SHELL_COPY.commands

const tab = (n: number): CommandDef => ({
  id: `tab-${n}` as CommandId,
  label: C.tab(n),
  code: `Digit${n}`,
  enabled: true
})

export const COMMANDS: CommandDef[] = [
  { id: 'search', label: C.search, code: 'KeyK', enabled: true },
  { id: 'new', label: C.new, code: 'KeyN', enabled: true },
  { id: 'newTab', label: C.newTab, code: 'KeyT', enabled: true },
  { id: 'split', label: C.split, code: 'Backslash', enabled: true },
  { id: 'closeTab', label: C.closeTab, code: 'KeyW', enabled: true },
  { id: 'sidebar', label: C.sidebar, code: 'KeyB', enabled: true },
  { id: 'copy', label: C.copy, code: 'KeyC', enabled: true },
  { id: 'paste', label: C.paste, code: 'KeyV', enabled: true },
  { id: 'draft', label: C.draft, code: 'KeyD', enabled: true },
  { id: 'sync', label: C.sync, code: 'KeyU', enabled: true },
  { id: 'shortcuts', label: C.shortcuts, code: null, enabled: true },
  { id: 'panel-prev', label: C['panel-prev'], code: 'ArrowLeft', enabled: true },
  { id: 'panel-next', label: C['panel-next'], code: 'ArrowRight', enabled: true },
  { id: 'cycle-prev', label: C['cycle-prev'], code: 'PageUp', enabled: true },
  { id: 'cycle-next', label: C['cycle-next'], code: 'PageDown', enabled: true },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(tab),
  { id: 'assistant', label: C.assistant, code: 'KeyA', enabled: false },
  { id: 'hub', label: C.hub, code: 'KeyM', enabled: false },
  { id: 'talk', label: C.talk, code: 'Space', enabled: false }
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
