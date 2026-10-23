import { describe, expect, it } from 'vitest'
import { claudeArgv, inUseBy, newSessionPrompt, ptyEnv, resolveLaunch } from './launch'
import type { Task } from './tasks'

const task = (uuids: string[]): Task => ({
  id: 'T-1',
  title: 'Teste',
  status: '',
  bucket: { idx: 10, name: 'Outros' },
  parent: null,
  dir: 'current',
  readmePath: '/b/T-1/README.md',
  sessions: uuids.map((uuid) => ({ date: '2026-10-01', uuid, desc: '' }))
})
const deps = (
  exist: Record<string, string>,
  running: Record<string, number> = {},
  gone: string[] = []
): Parameters<typeof resolveLaunch>[1] => ({
  find: async (u: string) => (u in exist ? { path: `/p/${u}.jsonl`, cwd: exist[u] } : null),
  elsewhere: async (u: string) => running[u] ?? null,
  cwdExists: async (d: string) => !gone.includes(d)
})

describe('resolveLaunch', () => {
  it('última sessão existe → resume com o cwd dela', async () => {
    expect(await resolveLaunch(task(['a', 'b']), deps({ a: '/x', b: '/y' }))).toEqual({
      kind: 'resume',
      uuid: 'b',
      cwd: '/y'
    })
  })
  it('última sumiu → penúltima', async () => {
    expect(await resolveLaunch(task(['a', 'b']), deps({ a: '/x' }))).toEqual({
      kind: 'resume',
      uuid: 'a',
      cwd: '/x'
    })
  })
  it('aberta em outra aba do app → elsewhere com a task dona', async () => {
    const d = { ...deps({ a: '/x' }), inApp: (u: string) => (u === 'a' ? 'T-2' : null) }
    expect(await resolveLaunch(task(['a']), d)).toEqual({
      kind: 'elsewhere',
      uuid: 'a',
      pid: 0,
      by: 'T-2'
    })
  })
  it('rodando fora → elsewhere', async () => {
    expect(await resolveLaunch(task(['a']), deps({ a: '/x' }, { a: 42 }))).toEqual({
      kind: 'elsewhere',
      uuid: 'a',
      pid: 42
    })
  })
  it('nenhuma existe → missing', async () => {
    expect(await resolveLaunch(task(['a', 'b']), deps({}))).toEqual({
      kind: 'missing',
      uuids: ['a', 'b']
    })
  })
  it('sem sessões → none', async () => {
    expect(await resolveLaunch(task([]), deps({}))).toEqual({ kind: 'none' })
  })
  it('pasta da sessão apagada (worktree removido) → gone', async () => {
    expect(await resolveLaunch(task(['a']), deps({ a: '/wt/x' }, {}, ['/wt/x']))).toEqual({
      kind: 'gone',
      uuid: 'a',
      cwd: '/wt/x'
    })
  })
  it('uuid explícito', async () => {
    expect(await resolveLaunch(task(['a', 'b']), deps({ a: '/x', b: '/y' }), 'a')).toEqual({
      kind: 'resume',
      uuid: 'a',
      cwd: '/x'
    })
  })
})

describe('claudeArgv', () => {
  it('título hostil vira um argumento só, sem shell', () => {
    const t = { ...task([]), title: `a "b" $(rm -rf ~)` }
    expect(claudeArgv(t, '/s/hooks.json', { resume: 'u1' })).toEqual([
      'claude',
      '--resume',
      'u1',
      '--name',
      `T-1 a "b" $(rm -rf ~)`,
      '--settings',
      '/s/hooks.json'
    ])
  })
  it('sessão nova leva o prompt', () => {
    const argv = claudeArgv(task([]), '/s', { newPrompt: true })
    expect(argv[1]).toBe(newSessionPrompt(task([])))
  })
})

describe('newSessionPrompt', () => {
  it('cita o README e a seção Sessões', () => {
    const p = newSessionPrompt(task([]))
    expect(p).toContain('/b/T-1/README.md')
    expect(p).toContain("'## Sessões'")
    expect(p).toContain('task T-1')
  })
})

describe('inUseBy', () => {
  it('outra task do app com o mesmo uuid', () => {
    expect(
      inUseBy(
        'u',
        new Map([
          ['T-1', 'u'],
          ['T-2', 'x']
        ]),
        'T-3'
      )
    ).toBe('T-1')
  })
  it('a própria task não conta', () => {
    expect(inUseBy('u', new Map([['T-3', 'u']]), 'T-3')).toBeNull()
  })
})

describe('ptyEnv', () => {
  it('remove ELECTRON_RUN_AS_NODE herdado (senão o shim do turnflow rodaria como node puro)', () => {
    const env = ptyEnv({ PATH: '/x', ELECTRON_RUN_AS_NODE: '1' }, {})
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(env.PATH).toBe('/x')
  })
  it('remove marcadores de sessão do claude pai (senão o transcript não é salvo)', () => {
    const env = ptyEnv(
      {
        PATH: '/x',
        CLAUDECODE: '1',
        CLAUDE_CODE_CHILD_SESSION: 'a',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        HOME: '/h'
      },
      { TURNFLOW_TASK: 'T-1' }
    )
    expect(env).toEqual({ PATH: '/x', HOME: '/h', TURNFLOW_TASK: 'T-1', TERM: 'xterm-256color' })
  })

  it('ptyEnv remove ELECTRON_RUN_AS_NODE, CLAUDECODE, CLAUDE_CODE_* e variáveis de sessão herdadas', () => {
    const env = ptyEnv(
      {
        ELECTRON_RUN_AS_NODE: '1',
        CLAUDECODE: '1',
        CLAUDE_CODE_ENTRYPOINT: 'x',
        TURNFLOW_SESSION_TOKEN: 'old',
        TURNFLOW_HOOK_PORT: '9',
        TURNFLOW_TASK: 'T-9',
        TURNFLOW_TOKEN: 'x',
        TURNFLOW_PORT: '1',
        HOME: '/h'
      },
      { HOME: '/override', TURNFLOW_TASK: 'T-1' }
    )
    expect(env).toEqual({ HOME: '/override', TERM: 'xterm-256color', TURNFLOW_TASK: 'T-1' })
  })
})
