import { activeBindings, commandFor } from './commands'

export type AppCmd =
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
  | { tab: number }
  | { panel: -1 | 1 }
  | { cycle: -1 | 1 }

type Key = { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; key: string; code: string }

const SIMPLE = new Set<string>([
  'search',
  'new',
  'newTab',
  'split',
  'closeTab',
  'sidebar',
  'copy',
  'paste',
  'draft',
  'sync',
  'shortcuts'
])

let commandBindings: Record<string, string> | null = null

/** O xterm consulta o atalho sem o estado do React. O App publica o mapa gravado. */
export function setCommandBindings(bindings: Record<string, string>): void {
  commandBindings = bindings
}

const asAppCmd = (id: string): AppCmd | null => {
  if (SIMPLE.has(id)) return id as AppCmd
  if (id.startsWith('tab-')) {
    const n = Number(id.slice(4))
    return n >= 1 && n <= 9 ? { tab: n } : null
  }
  if (id === 'panel-prev') return { panel: -1 }
  if (id === 'panel-next') return { panel: 1 }
  if (id === 'cycle-prev') return { cycle: -1 }
  if (id === 'cycle-next') return { cycle: 1 }
  return null
}

// Só Ctrl+Shift (sem Alt) é do app, pelo `code` físico (ABNT incluso). `bindings` remapeia.
export function appCommand(
  e: Key,
  bindings: Record<string, string> = commandBindings ?? activeBindings({})
): AppCmd | null {
  if (!e.ctrlKey || !e.shiftKey || e.altKey) return null
  const code = e.code === 'IntlBackslash' && bindings.split === 'Backslash' ? 'Backslash' : e.code
  const id = commandFor(bindings, code)
  return id ? asAppCmd(id) : null
}

/** Volta do formato do teclado para o id do registro (`commands.ts`). */
export function commandId(cmd: AppCmd): string {
  if (typeof cmd === 'string') return cmd
  if ('tab' in cmd) return `tab-${cmd.tab}`
  if ('panel' in cmd) return cmd.panel === -1 ? 'panel-prev' : 'panel-next'
  return cmd.cycle === -1 ? 'cycle-prev' : 'cycle-next'
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
