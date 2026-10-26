import { describe, expect, it } from 'vitest'
import { activeBindings, bindCommand, shortcutOverrides } from './commands'

describe('atalhos gravados', () => {
  it('comando que perdeu a tecla continua desvinculado depois de reabrir', () => {
    // search pega a tecla do new; depois search volta pra KeyK: o new ficou sem tecla
    let bindings = bindCommand(activeBindings({}), 'search', 'KeyN')
    bindings = bindCommand(bindings, 'search', 'KeyK')
    expect(bindings.new).toBeUndefined()
    const saved = shortcutOverrides(bindings)
    expect(saved).toEqual({ new: '' })
    const reopened = activeBindings(saved)
    expect(reopened.new).toBeUndefined()
    expect(reopened.search).toBe('KeyK')
  })

  it('tecla modificadora gravada não vale como atalho', () => {
    expect(activeBindings({ search: 'ShiftLeft' }).search).toBe('KeyK')
  })
})
