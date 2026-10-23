import { describe, expect, it } from 'vitest'
import { BRAND } from '../shared/brand'
import { SESSION_COPY } from '../shared/copy/session'
import {
  agentArgv,
  claudeArgv,
  initialPrompt,
  inUseBy,
  launchDir,
  newSessionPrompt,
  PROMPT_DESCRIPTION_MAX,
  ptyEnv,
  resolveLaunch,
  sessionEnv,
  shellArgv,
  splitCommand,
  type AgentCommands,
  type LaunchTask
} from './launch'
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
        TURNFLOW_HOOK_PORT: '1',
        TURNFLOW_PORT: '2',
        TURNFLOW_TASK: 'T-9',
        TURNFLOW_TOKEN: 'x',
        HOME: '/h'
      },
      {}
    )
    expect(env).toEqual({ HOME: '/h', TERM: 'xterm-256color' })
    expect(ptyEnv({ TURNFLOW_TASK: 'T-9' }, { TURNFLOW_TASK: 'T-1' }).TURNFLOW_TASK).toBe('T-1')
  })
})

const launchTask = (over: Partial<LaunchTask> = {}): LaunchTask => ({
  key: 'T-7',
  title: 'Ship the gate',
  description: 'do the thing',
  workdir: '/w',
  first_session: true,
  ...over
})

const bins = (over: Partial<AgentCommands> = {}): AgentCommands => ({
  claude: 'claude',
  codex: ['codex', '--yolo'],
  cursor: ['cursor-agent'],
  other: ['my-ai', '--x'],
  ...over
})

describe('launchDir', () => {
  it('launchDir', () => {
    expect(launchDir({ workdir: '/w' }, '/d', '/h')).toEqual({ dir: '/w' })
    expect(launchDir({ workdir: null }, '/d', '/h')).toEqual({ dir: '/d' })
    expect(launchDir({ workdir: null }, null, '/h')).toEqual({ ask: true })
    expect(launchDir(null, null, '/h')).toEqual({ dir: '/h' })
    expect(launchDir(null, '/d', '/h')).toEqual({ dir: '/d' })
  })
})

describe('initialPrompt', () => {
  it('prompt cita key, título e as duas tools, sem README', () => {
    const p = initialPrompt(launchTask())
    expect(p).toContain('T-7')
    expect(p).toContain('Ship the gate')
    expect(p).toContain('guidelines_get')
    expect(p).toContain('task_get')
    expect(p).toContain(BRAND.id)
    expect(p).not.toMatch(/readme/i)
  })

  it('descrição só na primeira sessão', () => {
    expect(initialPrompt(launchTask({ first_session: false }))).not.toContain('do the thing')
    expect(initialPrompt(launchTask({ description: '   ' }))).not.toContain(
      SESSION_COPY.descriptionIntro
    )
  })

  it('descrição de 100.000 chars cabe', () => {
    const p = initialPrompt(launchTask({ description: 'a'.repeat(100_000) }))
    expect(p.length).toBeLessThanOrEqual(PROMPT_DESCRIPTION_MAX + 600)
    expect(p.endsWith(SESSION_COPY.descriptionCut)).toBe(true)
  })
})

describe('agentArgv', () => {
  const settings = '/settings.json'
  const token = 'sekret-token-value'

  it('aspas, quebra e $ chegam intactos num item só', () => {
    const argv = agentArgv({
      tool: 'claude-code',
      bin: bins(),
      task: launchTask({
        title: 'a "b" $HOME',
        description: 'line\nwith `tick`',
        first_session: true
      }),
      resume: null,
      settingsPath: settings
    })
    expect(argv).toHaveLength(6)
    expect(argv[1]).toContain('a "b" $HOME')
    expect(argv[1]).toContain('line\nwith `tick`')
  })

  it('argv por ferramenta', () => {
    const task = launchTask({ first_session: false, description: '' })
    const prompt = initialPrompt(task)
    expect(
      agentArgv({ tool: 'claude-code', bin: bins(), task, resume: null, settingsPath: settings })
    ).toEqual(['claude', prompt, '--name', 'T-7 Ship the gate', '--settings', settings])
    expect(
      agentArgv({ tool: 'claude-code', bin: bins(), task, resume: 'U', settingsPath: settings })
    ).toEqual(['claude', '--resume', 'U', '--settings', settings, '--name', 'T-7 Ship the gate'])
    expect(
      agentArgv({
        tool: 'claude-code',
        bin: bins(),
        task: null,
        resume: null,
        settingsPath: settings
      })
    ).toEqual(['claude', '--settings', settings])
    expect(
      agentArgv({ tool: 'codex', bin: bins(), task, resume: null, settingsPath: settings })
    ).toEqual(['codex', '--yolo', prompt])
    expect(
      agentArgv({ tool: 'codex', bin: bins(), task, resume: 'U', settingsPath: settings })
    ).toEqual(['codex', '--yolo', 'resume', 'U'])
    expect(
      agentArgv({ tool: 'codex', bin: bins(), task: null, resume: null, settingsPath: settings })
    ).toEqual(['codex', '--yolo'])
    expect(
      agentArgv({ tool: 'cursor', bin: bins(), task, resume: null, settingsPath: settings })
    ).toEqual(['cursor-agent', prompt])
    expect(
      agentArgv({ tool: 'cursor', bin: bins(), task: null, resume: null, settingsPath: settings })
    ).toEqual(['cursor-agent'])
    expect(() =>
      agentArgv({ tool: 'cursor', bin: bins(), task, resume: 'U', settingsPath: settings })
    ).toThrow(expect.objectContaining({ code: 'VALIDATION', details: { reason: 'not_resumable' } }))
    expect(
      agentArgv({ tool: 'other', bin: bins(), task, resume: null, settingsPath: settings })
    ).toEqual(['my-ai', '--x'])
    expect(() =>
      agentArgv({
        tool: 'other',
        bin: bins({ other: null }),
        task,
        resume: null,
        settingsPath: settings
      })
    ).toThrow(
      expect.objectContaining({ code: 'VALIDATION', details: { reason: 'agent_not_configured' } })
    )
    expect(() =>
      agentArgv({ tool: 'other', bin: bins(), task, resume: 'U', settingsPath: settings })
    ).toThrow(expect.objectContaining({ code: 'VALIDATION', details: { reason: 'not_resumable' } }))
  })

  it('splitCommand', () => {
    expect(splitCommand('  my-ai  --flag x ')).toEqual(['my-ai', '--flag', 'x'])
  })

  it('sessionEnv', () => {
    const withTask = sessionEnv({
      path: '/bin',
      token,
      port: 9,
      socket: '/tmp/s',
      taskKey: 'T-1'
    })
    expect(withTask).toEqual({
      PATH: '/bin',
      TURNFLOW_SESSION_TOKEN: token,
      TURNFLOW_HOOK_PORT: '9',
      TURNFLOW_SOCKET: '/tmp/s',
      TURNFLOW_TASK: 'T-1'
    })
    const scratch = sessionEnv({ path: '/bin', token, port: 9, socket: '/tmp/s', taskKey: null })
    expect(scratch).toEqual({
      PATH: '/bin',
      TURNFLOW_SESSION_TOKEN: token,
      TURNFLOW_HOOK_PORT: '9',
      TURNFLOW_SOCKET: '/tmp/s'
    })
    expect('TURNFLOW_TASK' in scratch).toBe(false)
    const combos: Parameters<typeof agentArgv>[0][] = [
      {
        tool: 'claude-code',
        bin: bins(),
        task: launchTask(),
        resume: null,
        settingsPath: settings
      },
      { tool: 'claude-code', bin: bins(), task: launchTask(), resume: 'U', settingsPath: settings },
      { tool: 'claude-code', bin: bins(), task: null, resume: null, settingsPath: settings },
      { tool: 'codex', bin: bins(), task: launchTask(), resume: null, settingsPath: settings },
      { tool: 'codex', bin: bins(), task: null, resume: 'U', settingsPath: settings },
      { tool: 'cursor', bin: bins(), task: launchTask(), resume: null, settingsPath: settings },
      { tool: 'cursor', bin: bins(), task: null, resume: null, settingsPath: settings },
      { tool: 'other', bin: bins(), task: null, resume: null, settingsPath: settings }
    ]
    for (const c of combos) {
      for (const item of agentArgv(c)) expect(item).not.toContain(token)
    }
  })

  it('shellArgv', () => {
    expect(shellArgv('linux', { SHELL: '/bin/zsh' })).toEqual(['/bin/zsh', '-i'])
    expect(shellArgv('linux', {})).toEqual(['/bin/bash', '-i'])
    expect(shellArgv('darwin', { SHELL: '/bin/zsh' })).toEqual(['/bin/zsh', '-i'])
    expect(shellArgv('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })).toEqual([
      'C:\\Windows\\System32\\cmd.exe'
    ])
    expect(shellArgv('win32', {})).toEqual(['cmd.exe'])
  })
})
