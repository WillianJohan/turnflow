import { describe, expect, it } from 'vitest'
import { BRAND } from '../shared/brand'
import { SESSION_COPY } from '../shared/copy/session'
import {
  agentArgv,
  initialPrompt,
  launchDir,
  PROMPT_DESCRIPTION_MAX,
  ptyEnv,
  sessionEnv,
  shellArgv,
  splitCommand,
  type AgentCommands,
  type LaunchTask
} from './launch'

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

  it('.cmd no Windows: título e descrição nunca passam pelo argv do cmd.exe', () => {
    const task = launchTask({
      title: 'x" & calc.exe & "%PATH%^!',
      description: 'line\n| del *',
      first_session: true
    })
    const claude = 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd'
    const argv = agentArgv({
      tool: 'claude-code',
      bin: bins({ claude }),
      task,
      resume: null,
      settingsPath: 'C:\\run\\hooks.json'
    })
    expect(argv).toEqual([
      claude,
      SESSION_COPY.initialPromptBatch('T-7', BRAND.id),
      '--name',
      'T-7',
      '--settings',
      'C:\\run\\hooks.json'
    ])
    for (const a of argv.slice(1)) expect(a).not.toMatch(/[%^&|<>"!\r\n]/)
    const codex = agentArgv({
      tool: 'codex',
      bin: bins({ codex: ['C:\\npm\\codex.CMD'] }),
      task,
      resume: null,
      settingsPath: settings
    })
    expect(codex).toEqual(['C:\\npm\\codex.CMD', SESSION_COPY.initialPromptBatch('T-7', BRAND.id)])
  })

  it('.cmd com argumento que o cmd.exe interpretaria → VALIDATION, nunca lança', () => {
    expect(() =>
      agentArgv({
        tool: 'claude-code',
        bin: bins({ claude: 'C:\\npm\\claude.cmd' }),
        task: null,
        resume: null,
        settingsPath: 'C:\\a&b\\hooks.json'
      })
    ).toThrow(
      expect.objectContaining({ code: 'VALIDATION', details: { reason: 'unsafe_batch_arg' } })
    )
  })

  it('argv[0] cmd/cmd.exe (qualquer caixa, com path) segue a mesma regra do .cmd', () => {
    const task = launchTask({ title: 'x & calc', description: '%PATH%', first_session: true })
    for (const cmd of ['cmd', 'CMD.EXE', 'C:\\Windows\\System32\\cmd.exe', 'c:/windows/Cmd']) {
      const argv = agentArgv({
        tool: 'other',
        bin: bins({ other: [cmd, '/c', 'my-ai'] }),
        task,
        resume: null,
        settingsPath: settings
      })
      expect(argv).toEqual([cmd, '/c', 'my-ai'])
      expect(
        agentArgv({
          tool: 'codex',
          bin: bins({ codex: [cmd, '/c', 'codex'] }),
          task,
          resume: null,
          settingsPath: settings
        })
      ).toEqual([cmd, '/c', 'codex', SESSION_COPY.initialPromptBatch('T-7', BRAND.id)])
      expect(() =>
        agentArgv({
          tool: 'other',
          bin: bins({ other: [cmd, '/c', 'a&b'] }),
          task: null,
          resume: null,
          settingsPath: settings
        })
      ).toThrow(
        expect.objectContaining({ code: 'VALIDATION', details: { reason: 'unsafe_batch_arg' } })
      )
    }
    // nome que só contém "cmd" não é o cmd.exe
    expect(
      agentArgv({
        tool: 'codex',
        bin: bins({ codex: ['mycmd'] }),
        task,
        resume: null,
        settingsPath: settings
      })[1]
    ).toBe(initialPrompt(task))
  })

  it('.exe no Windows segue com o prompt inteiro', () => {
    const task = launchTask({ first_session: false, description: '' })
    expect(
      agentArgv({
        tool: 'claude-code',
        bin: bins({ claude: 'C:\\x\\claude.exe' }),
        task,
        resume: null,
        settingsPath: settings
      })[1]
    ).toBe(initialPrompt(task))
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
