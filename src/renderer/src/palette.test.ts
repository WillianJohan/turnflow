import { describe, expect, it } from 'vitest'
import { COMMANDS, activeBindings, bindCommand, commandFor } from './commands'
import { NEW_ACTIONS, cycleType, mergeFound, paletteItems } from './palette'
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
      found: [],
      types,
      mode: 'new',
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
      found: [],
      types,
      mode: 'search',
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

describe('paletteItems: achar antes de criar', () => {
  const found = [
    { id: 'u1', key: 'T-1', title: 'login quebrado', done: false },
    { id: 'u2', key: 'T-2', title: 'login antigo', done: true }
  ]

  it('busca: tasks encontradas primeiro, Create por último', () => {
    const rows = paletteItems({
      query: 'login',
      found,
      types,
      projects,
      commands: COMMANDS,
      mode: 'search'
    })
    expect(rows.map((r) => r.kind)).toEqual(['task', 'task', 'create'])
    expect(rows[0]).toMatchObject({ kind: 'task', id: 'u1' })
  })

  it('+ Novo > Task: Create primeiro, tasks depois', () => {
    const rows = paletteItems({
      query: 'login',
      found,
      types,
      projects,
      commands: COMMANDS,
      mode: 'new'
    })
    expect(rows.map((r) => r.kind)).toEqual(['create', 'task', 'task'])
  })

  it('comando desligado não aparece no >', () => {
    const rows = paletteItems({
      query: '>',
      found: [],
      types,
      projects,
      commands: COMMANDS,
      mode: 'search'
    })
    const ids = rows.map((r) => (r.kind === 'command' ? r.id : ''))
    expect(ids).not.toContain('assistant')
    expect(ids).toContain('closeTab')
  })
})

describe('mergeFound', () => {
  it('uma linha por task: hit do domínio vence a task do brain com a mesma key', () => {
    const merged = mergeFound(
      [
        { kind: 'task', task_id: 'u1', key: 'WF-1', title: 'A', snippet: '', done: false },
        { kind: 'checkpoint', task_id: 'u1', key: 'WF-1', title: 'A', snippet: '', done: false },
        { kind: 'checkpoint', task_id: 'u2', key: 'T-2', title: 'B', snippet: '', done: true }
      ],
      [
        { id: 'WF-1', key: 'WF-1', title: 'A (brain)' },
        { id: 'WF-3', key: 'WF-3', title: 'C (brain)' }
      ],
      'a'
    )
    expect(merged.map((r) => r.id)).toEqual(['u1', 'u2', 'WF-3'])
  })
})

describe('mergeFound: importadas e concluídas', () => {
  it('concluída vem marcada do hit', () => {
    const merged = mergeFound(
      [{ kind: 'task', task_id: 'u2', key: 'T-2', title: 'B', snippet: '', done: true }],
      [],
      'b'
    )
    expect(merged).toEqual([{ id: 'u2', key: 'T-2', title: 'B', done: true }])
  })

  it('task do brain já importada sai com o id do domínio e não duplica', () => {
    // FTS ainda sem resposta: só o brain, com a key traduzida pro ULID pelo App
    const pending = mergeFound([], [{ id: 'u1', key: 'WF-1', title: 'login' }], 'login')
    expect(pending).toEqual([{ id: 'u1', key: 'WF-1', title: 'login', done: false }])
    const later = mergeFound(
      [{ kind: 'task', task_id: 'u1', key: 'WF-1', title: 'login', snippet: '', done: false }],
      [{ id: 'u1', key: 'WF-1', title: 'login' }],
      'login'
    )
    expect(later.map((r) => r.id)).toEqual(['u1'])
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
