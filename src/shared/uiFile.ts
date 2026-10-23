import { z } from 'zod'

export const SIDEBAR_MIN = 220
export const SIDEBAR_MAX = 440
export const SIDEBAR_DEFAULT = 288

const TabId = z.string().min(1).max(256)

export const LayoutZ = z.object({
  panels: z.array(
    z.object({
      tabs: z.array(TabId),
      active: z.number().int().nonnegative(),
      preview: TabId.optional(),
      size: z.number().positive().optional()
    })
  ),
  focused: z.number().int().nonnegative()
})

export const FabZ = z.object({
  edge: z.enum(['left', 'right', 'top', 'bottom']),
  offset: z.number().finite()
})

export const UiFileZ = z
  .object({
    version: z.literal(1),
    layout: LayoutZ,
    sidebar: z.object({
      folded: z.boolean(),
      width: z.number().int().min(SIDEBAR_MIN).max(SIDEBAR_MAX)
    }),
    home: z.enum(['list', 'kanban']),
    fab: FabZ
  })
  .strict()

export type UiFile = z.infer<typeof UiFileZ>

export const DEFAULT_UI: UiFile = {
  version: 1,
  layout: { panels: [], focused: 0 },
  sidebar: { folded: false, width: SIDEBAR_DEFAULT },
  home: 'list',
  fab: { edge: 'right', offset: 24 }
}

export function clampSidebar(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)))
}

const Loose = z.object({
  version: z.number().optional(),
  layout: LayoutZ,
  sidebar: z.object({ folded: z.boolean(), width: z.number() }).optional(),
  home: z.enum(['list', 'kanban']).optional(),
  fab: FabZ.optional()
})

/** `null` quando o JSON não é um layout desta versão. Largura fora da faixa é puxada para dentro. */
export function parseUi(raw: string): UiFile | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = Loose.safeParse(json)
  if (!parsed.success || (parsed.data.version !== undefined && parsed.data.version !== 1))
    return null
  const layout = parsed.data.layout
  return {
    version: 1,
    layout: {
      panels: layout.panels.map((p) => ({
        ...p,
        active: p.tabs.length ? Math.min(p.active, p.tabs.length - 1) : 0
      })),
      focused: layout.panels.length ? Math.min(layout.focused, layout.panels.length - 1) : 0
    },
    sidebar: {
      folded: parsed.data.sidebar?.folded ?? false,
      width: clampSidebar(parsed.data.sidebar?.width ?? SIDEBAR_DEFAULT)
    },
    home: parsed.data.home ?? 'list',
    fab: parsed.data.fab ?? DEFAULT_UI.fab
  }
}
