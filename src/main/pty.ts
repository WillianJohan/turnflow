import { createRequire } from 'node:module'
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

/** Único lugar que carrega `node-pty`. O unit usa um spawner fake e nunca chama isto. */
export const nodePtySpawner: PtySpawner = (file, args, o) => {
  const pty = createRequire(__filename)('node-pty') as {
    spawn(
      file: string,
      args: string[],
      opts: { cols: number; rows: number; cwd: string; env: Record<string, string> }
    ): PtyProc
  }
  return pty.spawn(file, args, o)
}

export type PtyPool = {
  start(
    id: string,
    argv: string[],
    cwd: string,
    env: Record<string, string>,
    size: { cols: number; rows: number }
  ): void
  write(id: string, d: string): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): void
  killAndWait(id: string, ms: number): Promise<void>
  killAllAndWait(ms: number, filter?: (id: string) => boolean): Promise<void>
  alive(): string[]
  ownPids(): Set<number>
}

type Slot = { proc: PtyProc; waiters: (() => void)[]; sigkill?: ReturnType<typeof setTimeout> }

const DEFAULT_GRACE_MS = 3000

export function createPtyPool(o: {
  spawner: PtySpawner
  events: { data(id: string, d: string): void; exit(id: string, code: number): void }
  platform?: NodeJS.Platform
  baseEnv?: Record<string, string | undefined>
  killGraceMs?: number
}): PtyPool {
  const platform = o.platform ?? process.platform
  const grace = o.killGraceMs ?? DEFAULT_GRACE_MS
  const alive = new Map<string, Slot>()
  const leaving = new Map<string, Slot>()

  const finish = (id: string, slot: Slot, code: number): void => {
    if (slot.sigkill) clearTimeout(slot.sigkill)
    alive.delete(id)
    leaving.delete(id)
    const waiters = slot.waiters.splice(0)
    for (const w of waiters) w()
    o.events.exit(id, code)
  }

  const wait = (slot: Slot, ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        slot.waiters = slot.waiters.filter((w) => w !== done)
        resolve()
      }, ms)
      const done = (): void => {
        clearTimeout(timer)
        resolve()
      }
      slot.waiters.push(done)
    })

  const killSlot = (id: string, slot: Slot): void => {
    alive.delete(id)
    leaving.set(id, slot)
    slot.proc.kill()
    // No Windows o conpty só confirma a saída no onExit; SIGKILL por pid não vale (S1).
    if (platform === 'win32') return
    slot.sigkill = setTimeout(() => {
      if (!leaving.has(id)) return
      try {
        process.kill(slot.proc.pid, 'SIGKILL')
      } catch {
        // já saiu, ou o pid foi reciclado depois do onExit
      }
    }, grace)
  }

  const killAndWait = (id: string, ms: number): Promise<void> => {
    const slot = alive.get(id) ?? leaving.get(id)
    if (!slot) return Promise.resolve()
    if (alive.has(id)) killSlot(id, slot)
    return wait(slot, ms)
  }

  return {
    start(id, argv, cwd, env, size) {
      if (alive.has(id) || leaving.has(id)) throw new Error('pty_busy')
      const proc = o.spawner(argv[0], argv.slice(1), {
        cols: size.cols,
        rows: size.rows,
        cwd,
        env: ptyEnv(o.baseEnv ?? process.env, env)
      })
      const slot: Slot = { proc, waiters: [] }
      let closed = false
      alive.set(id, slot)
      proc.onData((d) => o.events.data(id, d))
      proc.onExit(({ exitCode }) => {
        if (closed) return
        closed = true
        finish(id, slot, exitCode)
      })
    },
    write(id, d) {
      alive.get(id)?.proc.write(d)
    },
    resize(id, cols, rows) {
      alive.get(id)?.proc.resize(cols, rows)
    },
    kill(id) {
      const slot = alive.get(id)
      if (slot) killSlot(id, slot)
    },
    killAndWait,
    killAllAndWait(ms, filter) {
      const ids = [...alive.keys()].filter((id) => (filter ? filter(id) : true))
      return Promise.all(ids.map((id) => killAndWait(id, ms))).then(() => undefined)
    },
    alive: () => [...alive.keys()],
    ownPids: () => new Set([...alive.values(), ...leaving.values()].map((s) => s.proc.pid))
  }
}
