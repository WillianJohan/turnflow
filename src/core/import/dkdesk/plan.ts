import { createHash } from 'node:crypto'
import type { AppConfig, Theme } from '../../../shared/types'
import type { DkdeskSource } from './read'

// Plano da migração do app legado (Decisão 22): só calcula, não escreve. Tema por id; config só nas
// chaves que o app ainda tem no valor padrão.

export type ThemeBase = { scheme: 'dark' | 'light'; bg: string; accent: string; ai: string }
export type DkdeskTheme = Theme & { base: ThemeBase }
export type DkdeskThemeAction = 'create' | 'skip_same' | 'skip_builtin' | 'skip_invalid'
export type DkdeskPlan = {
  token: string
  themes: { from: string; to: string | null; name: string; action: DkdeskThemeAction }[]
  config: Partial<AppConfig>
  ignored_keys: string[]
}
export type DkdeskDst = {
  config: Record<string, unknown>
  themes: { id: string; json: unknown | null }[]
  builtin: Record<string, Theme>
  defaults: AppConfig
}

const HEX = /^#[0-9a-f]{6}$/i
const ID = /^[\w.-]+$/
const COLOR_KEY = /^\w{1,40}$/
const NAME_MAX = 80
// base de um tema sem `ui.bg`/`ui.accent` válidos: as cores do tema escuro padrão
const FALLBACK_BG = '#14161a'
const FALLBACK_ACCENT = '#58a6ff'
const LEGACY_PREFIX = 'dkdesk-'
const MIGRATED = [
  'theme',
  'draftMode',
  'notifications',
  'fontSize',
  'termFont',
  'appFont',
  'appFontSize'
] as const

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const validId = (id: string): boolean => ID.test(id) && !id.startsWith('.')

/** Só entradas `chave → #rrggbb` (o mesmo critério do editor de temas); o resto é descartado. */
function colors(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isRecord(v)) return out
  for (const [k, c] of Object.entries(v))
    if (COLOR_KEY.test(k) && typeof c === 'string' && HEX.test(c)) out[k] = c
  return out
}

/** Tema do legado limpo (`ui`/`terminal` só com cores válidas), ou `null` se não há cor nenhuma. */
function normalizeTheme(json: unknown, id: string): Theme | null {
  if (!isRecord(json)) return null
  const ui = colors(json.ui)
  const terminal = colors(json.terminal)
  if (!Object.keys(ui).length && !Object.keys(terminal).length) return null
  const name =
    typeof json.name === 'string' && json.name.trim() ? json.name.trim().slice(0, NAME_MAX) : id
  return { name, ui, terminal }
}

const channel = (hex: string, i: number): number => {
  const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string): number =>
  0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)

/** Cores-base do tema: `scheme` pela luminância relativa de `ui.bg` (< 0,5 → escuro); `ai` = `accent`. */
export function themeBase(t: Theme): ThemeBase {
  const bg = HEX.test(t.ui.bg ?? '') ? t.ui.bg : FALLBACK_BG
  const accent = HEX.test(t.ui.accent ?? '') ? t.ui.accent : FALLBACK_ACCENT
  return { scheme: luminance(bg) < 0.5 ? 'dark' : 'light', bg, accent, ai: accent }
}

/** O que vai para o arquivo novo: tema limpo + `base`; `null` se o JSON não é um tema. */
export function toDkdeskTheme(json: unknown, id: string): DkdeskTheme | null {
  const t = normalizeTheme(json, id)
  return t && { ...t, base: themeBase(t) }
}

/** JSON com chaves em ordem fixa: compara conteúdo sem depender da ordem do arquivo. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (isRecord(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`
  return JSON.stringify(v) ?? 'null'
}
const contentKey = (ui: unknown, terminal: unknown): string =>
  canonical({ ui: isRecord(ui) ? ui : {}, terminal: isRecord(terminal) ? terminal : {} })

export function planDkdesk(src: DkdeskSource, dst: DkdeskDst): DkdeskPlan {
  const existing = [...dst.themes].sort((a, b) => a.id.localeCompare(b.id))
  const sameContent = new Map<string, string>()
  for (const t of existing)
    if (isRecord(t.json)) {
      const k = contentKey(t.json.ui, t.json.terminal)
      if (!sameContent.has(k)) sameContent.set(k, t.id)
    }
  const taken = new Set([...existing.map((t) => t.id), ...Object.keys(dst.builtin)])
  const free = (id: string): string => {
    if (!taken.has(id)) return id
    for (let n = 1; ; n++) {
      const c = `${LEGACY_PREFIX}${id}${n === 1 ? '' : `-${n}`}`
      if (!taken.has(c)) return c
    }
  }

  const themes: DkdeskPlan['themes'] = []
  for (const { id, json } of src.themes) {
    const t = normalizeTheme(json, id)
    const name = t?.name ?? id
    if (id in dst.builtin) {
      themes.push({ from: id, to: null, name, action: 'skip_builtin' })
    } else if (!t || !validId(id)) {
      themes.push({ from: id, to: null, name, action: 'skip_invalid' })
    } else {
      const same = sameContent.get(contentKey(t.ui, t.terminal))
      if (same !== undefined) {
        themes.push({ from: id, to: same, name, action: 'skip_same' })
      } else {
        const to = free(id)
        taken.add(to)
        themes.push({ from: id, to, name, action: 'create' })
      }
    }
  }

  const config: Record<string, unknown> = {}
  const from = src.config ?? {}
  for (const key of MIGRATED) {
    const def = dst.defaults[key]
    let value = from[key]
    if (typeof value !== typeof def) continue
    if (key === 'theme') {
      const moved = themes.find((t) => t.from === value)
      if (moved?.to) value = moved.to
      else if (typeof value !== 'string' || !(value in dst.builtin)) continue
    }
    // só migra o que o app ainda tem no padrão (ausente = padrão) e que de fato muda algo
    const mine = key in dst.config ? dst.config[key] : def
    if (mine === def && value !== def) config[key] = value
  }
  const ignored_keys = Object.keys(from)
    .filter((k) => !(MIGRATED as readonly string[]).includes(k))
    .sort()

  const token = createHash('sha256')
    .update(canonical({ themes, config, ignored_keys }))
    .digest('hex')
  return { token, themes, config: config as Partial<AppConfig>, ignored_keys }
}
