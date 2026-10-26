import { BRAND } from '../../shared/brand'
import { SHELL_COPY } from '../../shared/copy/shell'
// tabs = taskIds; preview = aba aberta com um clique (itálico), substituída pelo próximo clique
// size = peso na largura (flex-grow); ausente = 1
export type Panel = { tabs: string[]; active: number; preview?: string; size?: number }
export type Layout = { panels: Panel[]; focused: number }
export type Action =
  | { t: 'open'; taskId: string } // abre fixada (ou fixa a prévia)
  | { t: 'peek'; taskId: string } // um clique na lista: aba prévia
  | { t: 'pin'; taskId: string }
  | { t: 'resizePair'; panel: number; a: number; b: number } // divisória entre panel e panel+1
  | { t: 'equalize' }
  | { t: 'rename'; from: string; to: string } // aba avulsa adotada pela task
  | { t: 'alias'; from: string; to: string } // id do brain da task importada → id do domínio
  | { t: 'close'; taskId: string }
  | { t: 'split' }
  | { t: 'dropPanel'; panel: number }
  | { t: 'focusPanel'; dir: -1 | 1 }
  | { t: 'focusAt'; panel: number }
  | { t: 'focusTab'; n: number }
  | { t: 'cycleTab'; dir: -1 | 1 }
  | { t: 'move'; taskId: string; toPanel: number }
  | { t: 'splitMove'; taskId: string; panel: number; side: -1 | 1 } // aba solta na borda do painel
  | { t: 'retain'; ids: Set<string> }
  | { t: 'restore'; layout: Layout }

export const EMPTY: Layout = { panels: [], focused: 0 }

const find = (l: Layout, id: string): [number, number] => {
  for (let p = 0; p < l.panels.length; p++) {
    const i = l.panels[p].tabs.indexOf(id)
    if (i >= 0) return [p, i]
  }
  return [-1, -1]
}

const unpreview = (p: Panel, id: string): Panel =>
  p.preview === id ? { ...p, preview: undefined } : p

const clamp = (n: number, max: number): number => Math.max(0, Math.min(n, max))

// Remove a aba; painel que esvazia some e `focused` acompanha.
function removeTab(l: Layout, id: string): Layout {
  const [p, i] = find(l, id)
  if (p < 0) return l
  const tabs = l.panels[p].tabs.filter((_, j) => j !== i)
  if (!tabs.length) return dropPanel(l, p)
  const panels = [...l.panels]
  panels[p] = {
    ...l.panels[p],
    tabs,
    preview: l.panels[p].preview === id ? undefined : l.panels[p].preview,
    active: clamp(
      l.panels[p].active > i ? l.panels[p].active - 1 : l.panels[p].active,
      tabs.length - 1
    )
  }
  return { ...l, panels }
}

function dropPanel(l: Layout, p: number): Layout {
  const panels = l.panels.filter((_, j) => j !== p)
  if (!panels.length) return EMPTY
  return { panels, focused: clamp(l.focused > p ? l.focused - 1 : l.focused, panels.length - 1) }
}

const setPanel = (l: Layout, p: number, panel: Panel): Layout => ({
  ...l,
  panels: l.panels.map((x, j) => (j === p ? panel : x))
})

export function reduce(l: Layout, a: Action): Layout {
  switch (a.t) {
    case 'open': {
      const [p, i] = find(l, a.taskId)
      if (p >= 0)
        return { ...setPanel(l, p, { ...unpreview(l.panels[p], a.taskId), active: i }), focused: p }
      if (!l.panels.length) return { panels: [{ tabs: [a.taskId], active: 0 }], focused: 0 }
      const tabs = [...l.panels[l.focused].tabs, a.taskId]
      return setPanel(l, l.focused, { ...l.panels[l.focused], tabs, active: tabs.length - 1 })
    }
    case 'peek': {
      const [p, i] = find(l, a.taskId)
      if (p >= 0) return { ...setPanel(l, p, { ...l.panels[p], active: i }), focused: p }
      if (!l.panels.length)
        return { panels: [{ tabs: [a.taskId], active: 0, preview: a.taskId }], focused: 0 }
      const panel = l.panels[l.focused]
      const at = panel.preview ? panel.tabs.indexOf(panel.preview) : -1
      const tabs =
        at >= 0 ? panel.tabs.map((t, j) => (j === at ? a.taskId : t)) : [...panel.tabs, a.taskId]
      return setPanel(l, l.focused, {
        ...panel,
        tabs,
        active: at >= 0 ? at : tabs.length - 1,
        preview: a.taskId
      })
    }
    case 'rename': {
      let out = l
      const [tp] = find(out, a.to)
      if (tp >= 0 && a.from !== a.to) out = removeTab(out, a.to) // a task já aberta (README) dá lugar à aba viva
      const [p, i] = find(out, a.from)
      if (p < 0) return out
      return setPanel(out, p, {
        ...unpreview(out.panels[p], a.from),
        tabs: out.panels[p].tabs.map((t, j) => (j === i ? a.to : t))
      })
    }
    case 'alias': {
      if (a.from === a.to) return l
      const [fp, fi] = find(l, a.from)
      if (fp < 0) return l
      if (find(l, a.to)[0] >= 0) return reduce(removeTab(l, a.from), { t: 'open', taskId: a.to })
      const p = l.panels[fp]
      return setPanel(l, fp, {
        ...p,
        tabs: p.tabs.map((t, j) => (j === fi ? a.to : t)),
        preview: p.preview === a.from ? a.to : p.preview
      })
    }
    case 'resizePair': {
      if (!l.panels[a.panel] || !l.panels[a.panel + 1]) return l
      const panels = l.panels.map((p, j) =>
        j === a.panel ? { ...p, size: a.a } : j === a.panel + 1 ? { ...p, size: a.b } : p
      )
      return { ...l, panels }
    }
    case 'equalize':
      return { ...l, panels: l.panels.map((p) => ({ ...p, size: undefined })) }
    case 'pin': {
      const [p] = find(l, a.taskId)
      return p >= 0 && l.panels[p].preview === a.taskId
        ? setPanel(l, p, unpreview(l.panels[p], a.taskId))
        : l
    }
    case 'close':
      return removeTab(l, a.taskId)
    case 'split': {
      const at = l.panels.length ? l.focused + 1 : 0
      const panels = [...l.panels]
      panels.splice(at, 0, { tabs: [], active: 0 })
      return { panels, focused: at }
    }
    case 'dropPanel':
      return dropPanel(l, a.panel)
    case 'focusPanel':
      return { ...l, focused: clamp(l.focused + a.dir, l.panels.length - 1) }
    case 'focusAt':
      return l.panels[a.panel] && a.panel !== l.focused ? { ...l, focused: a.panel } : l
    case 'focusTab': {
      const panel = l.panels[l.focused]
      if (!panel || a.n < 1 || a.n > panel.tabs.length) return l
      return setPanel(l, l.focused, { ...panel, active: a.n - 1 })
    }
    case 'cycleTab': {
      const panel = l.panels[l.focused]
      if (!panel?.tabs.length) return l
      const n = panel.tabs.length
      return setPanel(l, l.focused, { ...panel, active: (panel.active + a.dir + n) % n })
    }
    case 'move': {
      const [p] = find(l, a.taskId)
      if (p < 0 || p === a.toPanel || !l.panels[a.toPanel]) return l
      const emptied = l.panels[p].tabs.length === 1
      const removed = removeTab(l, a.taskId)
      const to = emptied && p < a.toPanel ? a.toPanel - 1 : a.toPanel
      const tabs = [...removed.panels[to].tabs, a.taskId]
      return { ...setPanel(removed, to, { tabs, active: tabs.length - 1 }), focused: to }
    }
    case 'splitMove': {
      const [p] = find(l, a.taskId)
      if (p < 0 || !l.panels[a.panel]) return l
      const emptied = l.panels[p].tabs.length === 1
      if (emptied && p === a.panel) return l // única aba do painel: não tem o que dividir
      const removed = removeTab(l, a.taskId)
      const target = emptied && p < a.panel ? a.panel - 1 : a.panel
      const at = a.side === 1 ? target + 1 : target
      const panels = [...removed.panels]
      panels.splice(at, 0, { tabs: [a.taskId], active: 0 })
      return { panels, focused: at }
    }
    case 'retain': {
      let out = l
      for (const p of l.panels)
        for (const id of p.tabs)
          if (!a.ids.has(id) && !scratchKind(id) && id !== SETTINGS && id !== HOME)
            out = removeTab(out, id)
      return out
    }
    case 'restore': {
      const panels = a.layout.panels.map((p) => ({
        ...p,
        active: p.tabs.length ? Math.min(Math.max(0, p.active), p.tabs.length - 1) : 0
      }))
      if (!panels.length) return EMPTY
      return {
        panels,
        focused: Math.min(Math.max(0, a.layout.focused), panels.length - 1)
      }
    }
  }
}

export function loadLayout(raw: string | null): Layout {
  try {
    const l = JSON.parse(raw ?? '')
    const ok =
      Array.isArray(l?.panels) &&
      typeof l.focused === 'number' &&
      l.panels.every((p: Panel) => Array.isArray(p?.tabs) && typeof p.active === 'number')
    return ok ? l : EMPTY
  } catch {
    return EMPTY
  }
}

// Abas avulsas (sem task): "~claude-N" é um claude solto, "~shell-N" um terminal puro.
export type ScratchKind = 'claude' | 'shell'

export const scratchKind = (id: string): ScratchKind | null =>
  (id.match(/^~(claude|shell)-\d+$/)?.[1] as ScratchKind | undefined) ?? null

// `busy`: ids com processo/xterm ainda vivo (aba fechada há pouco, processo morrendo)
export function scratchId(kind: ScratchKind, l: Layout, busy: Set<string> = new Set()): string {
  const used = new Set([...l.panels.flatMap((p) => p.tabs), ...busy])
  let n = 1
  while (used.has(`~${kind}-${n}`)) n++
  return `~${kind}-${n}`
}

// Rótulo curto da aba: id da task, ou "Claude N" / "Terminal N" pras avulsas.
export function tabLabel(id: string): string {
  if (id === SETTINGS) return SHELL_COPY.tabs.settings
  if (id === HOME) return SHELL_COPY.tabs.home
  const k = scratchKind(id)
  const n = id.split('-')[1]
  return k ? (k === 'claude' ? SHELL_COPY.tabs.claude(n) : SHELL_COPY.tabs.terminal(n)) : id
}

// Título da janela reflete o que está na tela: aba ativa de cada painel. `keyOf` troca o id de
// domínio (ULID) pela key da task.
export function windowTitle(
  l: Layout,
  keyOf: (id: string) => string | undefined = () => undefined
): string {
  const ids = l.panels.map((p) => p.tabs[p.active]).filter(Boolean)
  const label = (id: string): string => keyOf(id) ?? tabLabel(id)
  return ids.length ? `${ids.map(label).join(' │ ')} — ${BRAND.name}` : BRAND.name
}

/** Id de task do domínio (ULID, 26 caracteres Crockford). Id do brain é a key (`WF-1`, `T-3`). */
export const isDomainId = (id: string): boolean => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)

/** Aba que não é de task: Início, Ajustes e as avulsas. */
export const isFixedTab = (id: string): boolean =>
  id === HOME || id === SETTINGS || scratchKind(id) !== null

// Aba única de configurações (tema, editor de tema, fontes, ícones...).
export const SETTINGS = '~settings'
export const HOME = '~home'
