import { describe, expect, it } from 'vitest'
import { appCommand, termKey } from './shortcuts'

type K = { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; key: string; code: string }

const k = (
  key: string,
  code: string,
  mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}
): K => ({
  ctrlKey: true,
  shiftKey: true,
  altKey: false,
  key,
  code,
  ...mods
})

describe('appCommand', () => {
  it.each([
    [k('K', 'KeyK'), 'search'],
    [k('|', 'Backslash'), 'split'],
    [k('W', 'KeyW'), 'closeTab'],
    [k('U', 'KeyU'), 'update'],
    [k('B', 'KeyB'), 'sidebar'],
    [k('C', 'KeyC'), 'copy'],
    [k('V', 'KeyV'), 'paste'],
    [k('D', 'KeyD'), 'draft'],
    [k('T', 'KeyT'), 'newTab']
  ])('%o', (e, cmd) => expect(appCommand(e)).toBe(cmd))

  it('Ctrl+Shift+3 com key "#" vira aba 3', () =>
    expect(appCommand(k('#', 'Digit3'))).toEqual({ tab: 3 }))
  it('setas trocam painel', () => {
    expect(appCommand(k('ArrowLeft', 'ArrowLeft'))).toEqual({ panel: -1 })
    expect(appCommand(k('ArrowRight', 'ArrowRight'))).toEqual({ panel: 1 })
  })
  it('PageUp/PageDown trocam aba', () => {
    expect(appCommand(k('PageUp', 'PageUp'))).toEqual({ cycle: -1 })
    expect(appCommand(k('PageDown', 'PageDown'))).toEqual({ cycle: 1 })
  })
  it.each([
    ['k', 'KeyK'],
    ['w', 'KeyW'],
    ['r', 'KeyR'],
    ['c', 'KeyC']
  ])('Ctrl+%s sem Shift fica com o terminal', (key, code) =>
    expect(appCommand(k(key, code, { shiftKey: false }))).toBeNull()
  )
  it('Ctrl+Shift+Alt+K não é do app', () =>
    expect(appCommand(k('K', 'KeyK', { altKey: true }))).toBeNull())
  it('Ctrl+Shift+R (não mapeado) fica com o terminal', () =>
    expect(appCommand(k('R', 'KeyR'))).toBeNull())
})

describe('termKey', () => {
  const e = (
    key: string,
    code: string,
    m: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}
  ): K => ({
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    key,
    code,
    ...m
  })
  it('Ctrl+C com seleção copia', () =>
    expect(termKey(e('c', 'KeyC', { ctrlKey: true }), true)).toBe('copy'))
  it('Ctrl+C sem seleção fica com o terminal (interrompe)', () =>
    expect(termKey(e('c', 'KeyC', { ctrlKey: true }), false)).toBeNull())
  it('Ctrl+V cola', () => expect(termKey(e('v', 'KeyV', { ctrlKey: true }), false)).toBe('paste'))
  it('Shift+Enter quebra linha', () =>
    expect(termKey(e('Enter', 'Enter', { shiftKey: true }), false)).toBe('newline'))
  it('Enter puro fica com o terminal', () => expect(termKey(e('Enter', 'Enter'), false)).toBeNull())
  it('Ctrl+Shift+C não é do termKey (é atalho do app)', () =>
    expect(termKey(e('C', 'KeyC', { ctrlKey: true, shiftKey: true }), true)).toBeNull())
})
