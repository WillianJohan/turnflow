import { describe, expect, it } from 'vitest'
import type { AppConfig, Theme } from '../../../shared/types'
import { planDkdesk, themeBase, toDkdeskTheme } from './plan'
import type { DkdeskSource } from './read'

const DEFAULTS: AppConfig = {
  theme: 'escuro',
  draftMode: false,
  notifications: true,
  fontSize: 13,
  termFont: 'JetBrains Mono',
  appFont: 'system-ui',
  appFontSize: 13,
  statusIcons: { Outros: 'x' },
  defaultWorkdir: null,
  brainDir: null
}
const BUILTIN: Record<string, Theme> = {
  escuro: { name: 'Dark', ui: { bg: '#14161a' }, terminal: { background: '#14161a' } },
  claro: { name: 'Light', ui: { bg: '#ffffff' }, terminal: { background: '#ffffff' } }
}
const dark = {
  name: 'Mine',
  ui: { bg: '#101010', accent: '#ff8800' },
  terminal: { background: '#101010' }
}
const light = {
  name: 'Bright',
  ui: { bg: '#fafafa', accent: '#0055ff' },
  terminal: { background: '#fafafa' }
}

const dst = (
  o: Partial<Parameters<typeof planDkdesk>[1]> = {}
): Parameters<typeof planDkdesk>[1] => ({
  config: { ...DEFAULTS },
  themes: [],
  builtin: BUILTIN,
  defaults: DEFAULTS,
  ...o
})
const src = (o: Partial<DkdeskSource> = {}): DkdeskSource => ({ config: null, themes: [], ...o })

describe('planDkdesk', () => {
  it('tema próprio vira create com base', () => {
    const s = src({
      themes: [
        { id: 'my-theme', json: dark },
        { id: 'bright', json: light }
      ]
    })
    const p = planDkdesk(s, dst())
    expect(p.themes).toEqual([
      { from: 'my-theme', to: 'my-theme', name: 'Mine', action: 'create' },
      { from: 'bright', to: 'bright', name: 'Bright', action: 'create' }
    ])
    const t = toDkdeskTheme(dark, 'my-theme')!
    expect(t.base).toEqual({ scheme: 'dark', bg: '#101010', accent: '#ff8800', ai: '#ff8800' })
    expect(themeBase(toDkdeskTheme(light, 'bright')!).scheme).toBe('light')
    expect(t.ui).toEqual(dark.ui)
    expect(t.terminal).toEqual(dark.terminal)
  })

  it('id de builtin é sempre skip_builtin, inclusive com conteúdo diferente', () => {
    const p = planDkdesk(src({ themes: [{ id: 'escuro', json: dark }] }), dst())
    expect(p.themes).toEqual([{ from: 'escuro', to: null, name: 'Mine', action: 'skip_builtin' }])
  })

  it('id ocupado vira dkdesk-<id>, e -2 se esse também está ocupado', () => {
    const taken = { id: 'my-theme', json: { name: 'Other', ui: { bg: '#222222' }, terminal: {} } }
    expect(
      planDkdesk(src({ themes: [{ id: 'my-theme', json: dark }] }), dst({ themes: [taken] }))
        .themes[0]
    ).toMatchObject({
      to: 'dkdesk-my-theme',
      action: 'create'
    })
    const taken2 = { id: 'dkdesk-my-theme', json: { ui: { bg: '#333333' }, terminal: {} } }
    expect(
      planDkdesk(
        src({ themes: [{ id: 'my-theme', json: dark }] }),
        dst({ themes: [taken, taken2] })
      ).themes[0].to
    ).toBe('dkdesk-my-theme-2')
  })

  it('mesmo conteúdo já presente é skip_same e config.theme aponta para o id existente', () => {
    const existing = { id: 'copy-of-mine', json: { ...dark, base: { scheme: 'dark' } } }
    const p = planDkdesk(
      src({ config: { theme: 'my-theme' }, themes: [{ id: 'my-theme', json: dark }] }),
      dst({ themes: [existing] })
    )
    expect(p.themes[0]).toMatchObject({ to: 'copy-of-mine', action: 'skip_same' })
    expect(p.config).toEqual({ theme: 'copy-of-mine' })
  })

  it('JSON inválido é skip_invalid', () => {
    const p = planDkdesk(
      src({
        themes: [
          { id: 'bad', json: null },
          { id: 'arr', json: [1] },
          { id: 'no-colors', json: { name: 'x' } }
        ]
      }),
      dst()
    )
    expect(p.themes.map((t) => t.action)).toEqual(['skip_invalid', 'skip_invalid', 'skip_invalid'])
    expect(p.themes.every((t) => t.to === null)).toBe(true)
  })

  it('config só nas chaves no padrão', () => {
    const p = planDkdesk(
      src({ config: { fontSize: 12, termFont: 'Fira Code', statusIcons: { A: 'b' }, zoom: 2 } }),
      dst({ config: { ...DEFAULTS, fontSize: 15 } })
    )
    expect(p.config).toEqual({ termFont: 'Fira Code' })
    expect(p.ignored_keys).toEqual(expect.arrayContaining(['statusIcons', 'zoom']))
    expect(p.ignored_keys).not.toContain('termFont')
  })

  it('token muda com o plano e não muda sem mudança', () => {
    const a = planDkdesk(src({ themes: [{ id: 'my-theme', json: dark }] }), dst())
    const b = planDkdesk(src({ themes: [{ id: 'my-theme', json: dark }] }), dst())
    const c = planDkdesk(src({ themes: [{ id: 'my-theme', json: light }] }), dst())
    expect(a.token).toBe(b.token)
    expect(a.token).not.toBe(c.token)
  })

  it('id que é propriedade de Object.prototype não é builtin', () => {
    const p = planDkdesk(
      src({
        config: { theme: 'toString' },
        themes: [
          { id: 'constructor', json: dark },
          { id: 'toString', json: light }
        ]
      }),
      dst()
    )
    expect(p.themes.map((t) => t.action)).toEqual(['create', 'create'])
    expect(p.config).toEqual({ theme: 'toString' })
    const q = planDkdesk(src({ config: { theme: '__proto__' } }), dst())
    expect(q.config).toEqual({})
  })

  it('limites: texto longo e número fora da faixa não entram; item grande não derruba a prévia', () => {
    const long = 'a'.repeat(257)
    const p = planDkdesk(
      src({
        config: {
          termFont: long,
          appFont: long,
          theme: long,
          fontSize: 500,
          appFontSize: 2,
          [long]: 1
        },
        themes: [
          { id: long, json: dark },
          { id: 'x'.repeat(250), json: dark },
          { id: 'ok', json: light }
        ]
      }),
      dst({ themes: [{ id: 'x'.repeat(250), json: { ui: { bg: '#111111' }, terminal: {} } }] })
    )
    expect(p.themes.map((t) => t.action)).toEqual(['skip_invalid', 'skip_invalid', 'create'])
    expect(p.themes.every((t) => t.from.length <= 256 && (t.to ?? '').length <= 256)).toBe(true)
    expect(p.config).toEqual({})
    expect(p.ignored_keys).toEqual(
      expect.arrayContaining(['fontSize', 'appFontSize', 'termFont', 'appFont', 'theme'])
    )
    expect(p.ignored_keys.every((k) => k.length <= 256)).toBe(true)
    expect(planDkdesk(src({ config: { fontSize: 8, appFontSize: 48 } }), dst()).config).toEqual({
      fontSize: 8,
      appFontSize: 48
    })
  })
})
