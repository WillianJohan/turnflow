import { describe, expect, it } from 'vitest'
import { COMMANDS, activeBindings, bindCommand, commandFor } from './commands'
import { NEW_ACTIONS, cycleType, paletteItems } from './palette'
import { appCommand } from './shortcuts'

const types = [
  { id: 'feature', name: 'Feature' },
  { id: 'bugfix', name: 'Bugfix' },
  { id: 'personal', name: 'Personal' }
]
const projects = [{ id: 'p1', name: 'Login' }]

describe('paletteItems', () => {
  it('propõe criar com o tipo adivinhado e o chip do projeto', () => {
    const [create] = paletteItems({
      query: 'corrigir login',
      tasks: [],
      types,
      projects,
      commands: COMMANDS
    })
    expect(create).toMatchObject({
      kind: 'create',
      title: 'corrigir login',
      typeId: 'bugfix',
      projectId: 'p1',
      projectName: 'Login'
    })
  })

  it('Tab troca o tipo da proposta', () => {
    expect(cycleType(types, 'bugfix')).toBe('personal')
    expect(cycleType(types, 'personal')).toBe('feature')
  })

  it('> lista os mesmos comandos do registro', () => {
    const rows = paletteItems({
      query: '> spl',
      tasks: [],
      types,
      projects,
      commands: COMMANDS
    })
    expect(rows.every((row) => row.kind === 'command')).toBe(true)
    expect(rows.map((row) => row.kind === 'command' && row.id)).toContain('split')
    expect(rows.map((row) => (row.kind === 'command' ? row.label : ''))).toEqual(
      COMMANDS.filter((command) => command.id === 'split').map((command) => command.label)
    )
  })
})

describe('NEW_ACTIONS', () => {
  it('oferece task, projeto, Claude sem task e terminal', () => {
    expect(NEW_ACTIONS.map((item) => item.id)).toEqual(['task', 'project', 'claude', 'terminal'])
  })
})

describe('atalhos remapeáveis', () => {
  it('Ctrl+Shift usa o code, então o ABNT continua na tecla física', () => {
    expect(
      appCommand({ ctrlKey: true, shiftKey: true, altKey: false, key: '#', code: 'Digit3' })
    ).toEqual({
      tab: 3
    })
  })

  it('um code novo passa a disparar o comando e o antigo solta', () => {
    const bindings = bindCommand(activeBindings({}), 'search', 'KeyP')
    const key = (
      code: string
    ): { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; key: string; code: string } => ({
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      key: code,
      code
    })
    expect(commandFor(bindings, 'KeyP')).toBe('search')
    expect(appCommand(key('KeyP'), bindings)).toBe('search')
    expect(appCommand(key('KeyK'), bindings)).toBeNull()
  })
})
