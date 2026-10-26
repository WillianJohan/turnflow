import { createRequire } from 'module'
import { ptyEnv } from './launch'

export type PtyProc = {
  pid: number
  onData(cb: (d: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(d: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type PtySpawner = (
  file: string,
  args: string[],
  o: { cols: number; rows: number; cwd: string; env: Record<string, string> }
) => PtyProc

// Único lugar que carrega o node-pty (binário do ABI do Electron): unit e int nunca passam
// por aqui, usam um spawner fake.
export const nodePtySpawner: PtySpawner = (file, args, o) =>
  (createRequire(__filename)('node-pty') as typeof import('node-pty')).spawn(file, args, o)

export type PtyPool = {
  /** Devolve a geração do processo: o `exit` dele chega com ela. */
  start(
    id: string,
    argv: string[],
    cwd: string,
    env: Record<string, string>,
    size: { cols: number; rows: number }
  ): number
  write(id: string, d: string): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): void
  killAndWait(id: string, ms: number): Promise<void>
  killAllAndWait(ms: number, filter?: (id: string) => boolean): Promise<void>
  alive(): string[]
  /** Vivo ou morto e ainda sem `onExit`: `start` nesse id lança `pty_busy`. */
  busy(id: string): boolean
  ownPids(): Set<number>
}

type Events = {
  data(id: string, d: string): void
  /** `gen` é a geração devolvida pelo `start` do processo que saiu. */
  exit(id: string, code: number, gen: number): void
}
type Leaving = {
  p: PtyProc
  gen: number
  waiters: Set<() => void>
  timer: NodeJS.Timeout | null
}

export function createPtyPool(o: {
  spawner: PtySpawner
  events: Events
  platform?: NodeJS.Platform
  baseEnv?: Record<string, string | undefined>
  killGraceMs?: number
  /** Depois do SIGKILL, quanto esperar o `onExit` antes de liberar o id na marra. */
  stuckMs?: number
  log?: (line: string) => void
}): PtyPool {
  const platform = o.platform ?? process.platform
  const grace = o.killGraceMs ?? 3000
  const stuck = o.stuckMs ?? 2000
  const live = new Map<string, { p: PtyProc; gen: number }>()
  // liberados sem onExit: um exit que chegue depois não fala por ninguém
  const released = new WeakSet<PtyProc>()
  let gens = 0
  // morto por `kill` e ainda sem `onExit`: o id continua ocupado até o processo sair de fato
  const leaving = new Map<string, Leaving>()

  const settle = (id: string, l: Leaving): void => {
    leaving.delete(id)
    if (l.timer) clearTimeout(l.timer)
    for (const w of [...l.waiters]) w()
  }

  // node-pty põe o filho numa sessão própria (pgid = pid): o SIGKILL vai pro grupo, e os netos
  // (shell → claude → node) não ficam órfãos. Grupo que não existe mais cai no pid.
  const hardKill = (pid: number): void => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // já saiu
      }
    }
  }

  const kill = (id: string): void => {
    const cur = live.get(id)
    if (!cur) return
    live.delete(id)
    const { p, gen } = cur
    const l: Leaving = { p, gen, waiters: new Set(), timer: null }
    leaving.set(id, l)
    p.kill()
    // claude que ignora SIGHUP vira processo invisível; sem exit em `grace` vai no SIGKILL.
    // No Windows (conpty) matar por pid não existe: só `p.kill()` e esperar o exit.
    if (platform !== 'win32')
      l.timer = setTimeout(() => {
        hardKill(p.pid)
        // nem o SIGKILL trouxe o onExit (o node-pty perdeu o evento): libera o id com log, senão
        // a aba ficaria em pty_busy para sempre
        l.timer = setTimeout(() => {
          l.timer = null
          if (leaving.get(id) !== l) return
          released.add(p)
          settle(id, l)
          o.log?.(`pty ${id}: no exit ${stuck} ms after SIGKILL (pid ${p.pid}); id released`)
          o.events.exit(id, -1, gen)
        }, stuck)
      }, grace)
  }

  const waitExit = (id: string, ms: number): Promise<void> => {
    const l = leaving.get(id)
    if (!l) return Promise.resolve()
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(t)
        l.waiters.delete(done)
        resolve()
      }
      const t = setTimeout(done, ms)
      l.waiters.add(done)
    })
  }

  const killAndWait = (id: string, ms: number): Promise<void> => {
    kill(id)
    return waitExit(id, ms)
  }

  return {
    start(id, argv, cwd, env, size) {
      if (live.has(id) || leaving.has(id)) throw new Error('pty_busy')
      const p = o.spawner(argv[0], argv.slice(1), {
        cols: size.cols,
        rows: size.rows,
        cwd,
        env: ptyEnv(o.baseEnv ?? process.env, env, platform)
      })
      const gen = ++gens
      live.set(id, { p, gen })
      p.onData((d) => o.events.data(id, d))
      p.onExit(({ exitCode }) => {
        if (released.has(p)) return
        // só o exit do processo certo libera o id: o de um processo velho nunca encerra o novo
        if (live.get(id)?.p === p) live.delete(id)
        const l = leaving.get(id)
        if (l?.p === p) settle(id, l)
        o.events.exit(id, exitCode, gen)
      })
      return gen
    },
    write: (id, d) => live.get(id)?.p.write(d),
    resize: (id, c, r) => live.get(id)?.p.resize(c, r),
    kill,
    killAndWait,
    killAllAndWait: async (ms, filter) => {
      const ids = [...live.keys(), ...leaving.keys()].filter((id) => !filter || filter(id))
      await Promise.all(ids.map((id) => killAndWait(id, ms)))
    },
    alive: () => [...live.keys()],
    busy: (id) => live.has(id) || leaving.has(id),
    ownPids: () => new Set([...live.values(), ...leaving.values()].map(({ p }) => p.pid))
  }
}
