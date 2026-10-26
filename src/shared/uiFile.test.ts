import { describe, expect, it } from 'vitest'
import { clampSidebar, parseUi, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from './uiFile'

const layout = { panels: [{ tabs: ['T-1'], active: 0 }], focused: 0 }

describe('parseUi', () => {
  it('lixo e arquivo sem layout viram null', () => {
    expect(parseUi('{lixo')).toBeNull()
    expect(parseUi('{}')).toBeNull()
    expect(parseUi('null')).toBeNull()
  })

  it('completa sidebar, home e fab quando só o layout veio', () => {
    expect(parseUi(JSON.stringify({ layout }))).toEqual({
      version: 1,
      layout,
      sidebar: { folded: false, width: SIDEBAR_DEFAULT },
      home: 'list',
      fab: { edge: 'right', offset: 24 },
      density: 'normal',
      shortcuts: {}
    })
  })

  it('versão futura não é aceita', () => {
    expect(parseUi(JSON.stringify({ version: 2, layout }))).toBeNull()
  })

  it('largura fora da faixa é puxada para dentro', () => {
    const raw = JSON.stringify({
      layout,
      sidebar: { folded: true, width: 900 }
    })
    expect(parseUi(raw)?.sidebar).toEqual({ folded: true, width: SIDEBAR_MAX })
  })
})

describe('clampSidebar', () => {
  it('fica entre 220 e 440 e o vazio volta a 288', () => {
    expect(SIDEBAR_MIN).toBe(220)
    expect(SIDEBAR_MAX).toBe(440)
    expect(SIDEBAR_DEFAULT).toBe(288)
    expect(clampSidebar(100)).toBe(220)
    expect(clampSidebar(900)).toBe(440)
    expect(clampSidebar(300.4)).toBe(300)
    expect(clampSidebar(Number.NaN)).toBe(288)
  })
})

describe('shortcuts do ui.json', () => {
  it('tecla modificadora não vira atalho; vazio = desvinculado fica gravado', () => {
    const raw = JSON.stringify({
      layout,
      shortcuts: {
        search: 'ShiftLeft',
        new: 'ControlRight',
        split: 'AltLeft',
        sidebar: 'MetaLeft',
        draft: 'KeyJ',
        sync: ''
      }
    })
    expect(parseUi(raw)?.shortcuts).toEqual({ draft: 'KeyJ', sync: '' })
  })
})
