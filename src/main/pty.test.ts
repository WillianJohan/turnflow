import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPtyPool, type PtyPool, type PtyProc, type PtySpawner } from './pty'

type Fake = PtyProc & { emitData(d: string): void; emitExit(code?: number): void; kills: number }

type Setup = {
  pool: PtyPool
  calls: { file: string; args: string[]; o: Parameters<PtySpawner>[2] }[]
  procs: Fake[]
  events: { data: Mock; exit: Mock }
}

function setup(platform: NodeJS.Platform = 'linux'): Setup {
  const calls: { file: string; args: string[]; o: Parameters<PtySpawner>[2] }[] = []
  const procs: Fake[] = []
  const spawner: PtySpawner = (file, args, o) => {
    calls.push({ file, args, o })
    let data: (d: string) => void = () => undefined
    let exit: (e: { exitCode: number }) => void = () => undefined
    const p: Fake = {
      pid: 1000 + procs.length,
      onData: (cb) => void (data = cb),
      onExit: (cb) => void (exit = cb),
      write: () => undefined,
      resize: () => undefined,
      kill: () => void p.kills++,
      emitData: (d) => data(d),
      emitExit: (code = 0) => exit({ exitCode: code }),
      kills: 0
    }
    procs.push(p)
    return p
  }
  const events = { data: vi.fn(), exit: vi.fn() }
  const pool = createPtyPool({
    spawner,
    events,
    platform,
    baseEnv: { HOME: '/h', CLAUDECODE: '1' }
  })
  return { pool, calls, procs, events }
}
const size = { cols: 80, rows: 24 }

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createPtyPool', () => {
  it('start passa argv, cwd e env filtrado ao spawner', () => {
    const { pool, calls } = setup()
    pool.start('a', ['claude', '--x'], '/w', { FOO: 'bar' }, size)
    expect(calls).toHaveLength(1)
    expect(calls[0].file).toBe('claude')
    expect(calls[0].args).toEqual(['--x'])
    expect(calls[0].o).toEqual({
      cols: 80,
      rows: 24,
      cwd: '/w',
      env: { HOME: '/h', TERM: 'xterm-256color', FOO: 'bar' }
    })
  })

  it('data e exit chegam com o id', () => {
    const { pool, procs, events } = setup()
    pool.start('a', ['sh'], '/w', {}, size)
    procs[0].emitData('oi')
    procs[0].emitExit(3)
    expect(events.data).toHaveBeenCalledWith('a', 'oi')
    expect(events.exit).toHaveBeenCalledWith('a', 3, 1)
  })

  it('start com id vivo lança pty_busy', () => {
    const { pool } = setup()
    pool.start('a', ['sh'], '/w', {}, size)
    expect(() => pool.start('a', ['sh'], '/w', {}, size)).toThrow('pty_busy')
  })

  it('reabrir aba antes do exit do processo velho lança pty_busy; depois do exit abre', () => {
    const { pool, procs, events, calls } = setup()
    pool.start('a', ['sh'], '/w', {}, size)
    pool.kill('a')
    expect(pool.alive()).toEqual([])
    expect(() => pool.start('a', ['sh'], '/w', {}, size)).toThrow('pty_busy')
    expect(calls).toHaveLength(1)
    procs[0].emitExit(0)
    pool.start('a', ['sh'], '/w', {}, size)
    expect(calls).toHaveLength(2)
    expect(pool.alive()).toEqual(['a'])
    // o exit do velho já passou; o do novo é que encerra a sessão nova
    expect(events.exit).toHaveBeenCalledTimes(1)
    procs[1].emitExit(0)
    expect(events.exit).toHaveBeenCalledTimes(2)
  })

  it('exit tira o id de alive e de ownPids', () => {
    const { pool, procs } = setup()
    pool.start('a', ['sh'], '/w', {}, size)
    expect(pool.alive()).toEqual(['a'])
    expect(pool.ownPids()).toEqual(new Set([1000]))
    procs[0].emitExit()
    expect(pool.alive()).toEqual([])
    expect(pool.ownPids().size).toBe(0)
  })

  it('kill fora do Windows manda SIGKILL depois de 3 s sem exit', () => {
    vi.useFakeTimers()
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const { pool, procs } = setup()
    pool.start('a', ['sh'], '/w', {}, size)
    pool.kill('a')
    expect(procs[0].kills).toBe(1)
    vi.advanceTimersByTime(2999)
    expect(killSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(killSpy).toHaveBeenCalledWith(1000, 'SIGKILL')
  })

  it('kill com exit antes de 3 s não manda SIGKILL', () => {
    vi.useFakeTimers()
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const { pool, procs } = setup()
    pool.start('a', ['sh'], '/w', {}, size)
    pool.kill('a')
    procs[0].emitExit()
    vi.advanceTimersByTime(10_000)
    expect(killSpy).not.toHaveBeenCalled()
  })

  it('win32 nunca chama process.kill', async () => {
    vi.useFakeTimers()
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const { pool, procs } = setup('win32')
    pool.start('a', ['sh'], '/w', {}, size)
    pool.kill('a')
    vi.advanceTimersByTime(10_000)
    expect(procs[0].kills).toBe(1)
    expect(killSpy).not.toHaveBeenCalled()
    const w = pool.killAndWait('a', 500)
    vi.advanceTimersByTime(500)
    await w
    expect(killSpy).not.toHaveBeenCalled()
  })

  it('killAndWait resolve no exit', async () => {
    vi.useFakeTimers()
    const { pool, procs } = setup()
    pool.start('a', ['sh'], '/w', {}, size)
    let done = false
    const w = pool.killAndWait('a', 5000).then(() => void (done = true))
    await Promise.resolve()
    expect(done).toBe(false)
    expect(procs[0].kills).toBe(1)
    procs[0].emitExit()
    await w
    expect(done).toBe(true)
  })

  it('killAndWait resolve no teto sem exit, também para id já em saída', async () => {
    vi.useFakeTimers()
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const { pool, procs } = setup()
    pool.start('a', ['sh'], '/w', {}, size)
    pool.kill('a')
    let done = false
    const w = pool.killAndWait('a', 1000).then(() => void (done = true))
    vi.advanceTimersByTime(999)
    await Promise.resolve()
    expect(done).toBe(false)
    vi.advanceTimersByTime(1)
    await w
    expect(done).toBe(true)
    expect(procs[0].kills).toBe(1) // não matou duas vezes
  })

  it('killAndWait de id desconhecido resolve na hora', async () => {
    const { pool } = setup()
    await expect(pool.killAndWait('x', 1000)).resolves.toBeUndefined()
  })

  it('killAllAndWait com filtro só mata os escolhidos', async () => {
    const { pool, procs } = setup()
    pool.start('a', ['sh'], '/w', {}, size)
    pool.start('b', ['sh'], '/w', {}, size)
    const w = pool.killAllAndWait(1000, (id) => id === 'a')
    procs[0].emitExit()
    await w
    expect(procs[0].kills).toBe(1)
    expect(procs[1].kills).toBe(0)
    expect(pool.alive()).toEqual(['b'])
  })
})
