import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPtyPool, type PtyProc, type PtySpawner } from './pty'

type Call = { file: string; args: string[]; cwd: string; env: Record<string, string>; pid: number }

type Fake = {
  spawner: PtySpawner
  calls: Call[]
  emitData(pid: number, d: string): void
  emitExit(pid: number, code: number): void
  killed(pid: number): boolean
}

function fakeSpawner(): Fake {
  const calls: Call[] = []
  const procs = new Map<
    number,
    { data: ((d: string) => void)[]; exit: ((e: { exitCode: number }) => void)[]; killed: boolean }
  >()
  let n = 1000
  const spawner: PtySpawner = (file, args, o) => {
    const pid = ++n
    const rec = {
      data: [] as ((d: string) => void)[],
      exit: [] as ((e: { exitCode: number }) => void)[],
      killed: false
    }
    procs.set(pid, rec)
    calls.push({ file, args, cwd: o.cwd, env: o.env, pid })
    const proc: PtyProc = {
      pid,
      onData: (cb) => void rec.data.push(cb),
      onExit: (cb) => void rec.exit.push(cb),
      write: () => undefined,
      resize: () => undefined,
      kill: () => {
        rec.killed = true
      }
    }
    return proc
  }
  return {
    spawner,
    calls,
    emitData: (pid, d) => procs.get(pid)?.data.forEach((cb) => cb(d)),
    emitExit: (pid, code) => procs.get(pid)?.exit.forEach((cb) => cb({ exitCode: code })),
    killed: (pid) => procs.get(pid)?.killed ?? false
  }
}

const events = (): {
  data: (id: string, d: string) => void
  exit: (id: string, code: number) => void
  dataLog: [string, string][]
  exitLog: [string, number][]
} => {
  const dataLog: [string, string][] = []
  const exitLog: [string, number][] = []
  return {
    data: (id: string, d: string) => void dataLog.push([id, d]),
    exit: (id: string, code: number) => void exitLog.push([id, code]),
    dataLog,
    exitLog
  }
}

describe('createPtyPool', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('start passa argv, cwd e env filtrado ao spawner', () => {
    const fake = fakeSpawner()
    const ev = events()
    const pool = createPtyPool({
      spawner: fake.spawner,
      events: ev,
      baseEnv: { PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', HOME: '/h' }
    })
    pool.start(
      'T-1',
      ['claude', '--settings', '/s'],
      '/w',
      { TURNFLOW_TASK: 'T-1' },
      { cols: 80, rows: 24 }
    )
    expect(fake.calls).toEqual([
      {
        file: 'claude',
        args: ['--settings', '/s'],
        cwd: '/w',
        env: { PATH: '/bin', HOME: '/h', TERM: 'xterm-256color', TURNFLOW_TASK: 'T-1' },
        pid: 1001
      }
    ])
  })

  it('data e exit chegam com o id', () => {
    const fake = fakeSpawner()
    const ev = events()
    const pool = createPtyPool({ spawner: fake.spawner, events: ev, baseEnv: {} })
    pool.start('T-1', ['claude'], '/w', {}, { cols: 80, rows: 24 })
    fake.emitData(1001, 'hi')
    fake.emitExit(1001, 0)
    expect(ev.dataLog).toEqual([['T-1', 'hi']])
    expect(ev.exitLog).toEqual([['T-1', 0]])
  })

  it('start com id vivo lança pty_busy', () => {
    const fake = fakeSpawner()
    const pool = createPtyPool({ spawner: fake.spawner, events: events(), baseEnv: {} })
    pool.start('T-1', ['claude'], '/w', {}, { cols: 80, rows: 24 })
    expect(() => pool.start('T-1', ['claude'], '/w', {}, { cols: 80, rows: 24 })).toThrow(
      'pty_busy'
    )
    expect(fake.calls).toHaveLength(1)
  })

  it('reabrir aba antes do exit do processo velho lança pty_busy; depois do exit abre', () => {
    const fake = fakeSpawner()
    const ev = events()
    const pool = createPtyPool({ spawner: fake.spawner, events: ev, baseEnv: {} })
    pool.start('T-1', ['old'], '/w', {}, { cols: 80, rows: 24 })
    pool.kill('T-1')
    expect(pool.alive()).toEqual([])
    expect(() => pool.start('T-1', ['new'], '/w', {}, { cols: 80, rows: 24 })).toThrow('pty_busy')
    expect(fake.calls).toHaveLength(1)
    fake.emitExit(1001, 0)
    expect(ev.exitLog).toEqual([['T-1', 0]])
    pool.start('T-1', ['new'], '/w', {}, { cols: 80, rows: 24 })
    expect(fake.calls[1].file).toBe('new')
    expect(pool.alive()).toEqual(['T-1'])
  })

  it('kill fora do Windows manda SIGKILL depois de 3 s sem exit', () => {
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const fake = fakeSpawner()
    const pool = createPtyPool({
      spawner: fake.spawner,
      events: events(),
      platform: 'linux',
      baseEnv: {}
    })
    pool.start('T-1', ['claude'], '/w', {}, { cols: 80, rows: 24 })
    pool.kill('T-1')
    expect(fake.killed(1001)).toBe(true)
    expect(kill).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2999)
    expect(kill).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(kill).toHaveBeenCalledWith(1001, 'SIGKILL')
  })

  it('kill com exit antes de 3 s não manda SIGKILL', () => {
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const fake = fakeSpawner()
    const pool = createPtyPool({
      spawner: fake.spawner,
      events: events(),
      platform: 'linux',
      baseEnv: {}
    })
    pool.start('T-1', ['claude'], '/w', {}, { cols: 80, rows: 24 })
    pool.kill('T-1')
    fake.emitExit(1001, 0)
    vi.advanceTimersByTime(5000)
    expect(kill).not.toHaveBeenCalled()
  })

  it('win32 nunca chama process.kill', () => {
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const fake = fakeSpawner()
    const pool = createPtyPool({
      spawner: fake.spawner,
      events: events(),
      platform: 'win32',
      baseEnv: {}
    })
    pool.start('T-1', ['claude'], '/w', {}, { cols: 80, rows: 24 })
    pool.kill('T-1')
    expect(fake.killed(1001)).toBe(true)
    vi.advanceTimersByTime(10_000)
    expect(kill).not.toHaveBeenCalled()
  })

  it('killAndWait resolve no exit', async () => {
    const fake = fakeSpawner()
    const pool = createPtyPool({
      spawner: fake.spawner,
      events: events(),
      platform: 'linux',
      baseEnv: {}
    })
    pool.start('T-1', ['claude'], '/w', {}, { cols: 80, rows: 24 })
    const done = pool.killAndWait('T-1', 5000)
    fake.emitExit(1001, 0)
    await done
    expect(pool.alive()).toEqual([])
  })

  it('killAndWait resolve no teto sem exit', async () => {
    vi.useFakeTimers()
    const fake = fakeSpawner()
    const pool = createPtyPool({
      spawner: fake.spawner,
      events: events(),
      platform: 'linux',
      baseEnv: {}
    })
    pool.start('T-1', ['claude'], '/w', {}, { cols: 80, rows: 24 })
    let settled = false
    const done = pool.killAndWait('T-1', 1000).then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(settled).toBe(true)
  })

  it('killAllAndWait com filtro só mata os escolhidos', async () => {
    const fake = fakeSpawner()
    const pool = createPtyPool({
      spawner: fake.spawner,
      events: events(),
      platform: 'linux',
      baseEnv: {}
    })
    pool.start('a', ['a'], '/w', {}, { cols: 80, rows: 24 })
    pool.start('b', ['b'], '/w', {}, { cols: 80, rows: 24 })
    const done = pool.killAllAndWait(5000, (id) => id === 'a')
    expect(fake.killed(1001)).toBe(true)
    expect(fake.killed(1002)).toBe(false)
    expect(pool.alive()).toEqual(['b'])
    fake.emitExit(1001, 0)
    await done
    expect(pool.alive()).toEqual(['b'])
  })

  it('exit tira o id de alive', () => {
    const fake = fakeSpawner()
    const pool = createPtyPool({ spawner: fake.spawner, events: events(), baseEnv: {} })
    pool.start('T-1', ['claude'], '/w', {}, { cols: 80, rows: 24 })
    expect(pool.alive()).toEqual(['T-1'])
    expect(pool.ownPids()).toEqual(new Set([1001]))
    fake.emitExit(1001, 0)
    expect(pool.alive()).toEqual([])
    expect(pool.ownPids()).toEqual(new Set())
  })
})
