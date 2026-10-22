import * as pty from 'node-pty'
import { ptyEnv } from './launch'

type Events = { data(id: string, d: string): void; exit(id: string, code: number): void }

// ref.id muda quando a aba avulsa é adotada por uma task (renamePty); eventos usam o id atual
type Entry = { p: pty.IPty; ref: { id: string } }
const ptys = new Map<string, Entry>()
const exited = new WeakSet<pty.IPty>()

export function startPty(
  id: string,
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  cols: number,
  rows: number,
  ev: Events
): void {
  if (ptys.has(id)) throw new Error(`${id} já tem sessão viva`)
  const p = pty.spawn(argv[0], argv.slice(1), { cols, rows, cwd, env: ptyEnv(process.env, env) })
  const ref = { id }
  ptys.set(id, { p, ref })
  p.onData((d) => ev.data(ref.id, d))
  p.onExit(({ exitCode }) => {
    exited.add(p)
    // processo antigo morrendo depois de uma troca de sessão: o novo já ocupa o id
    if (ptys.has(ref.id) && ptys.get(ref.id)?.p !== p) return
    ptys.delete(ref.id)
    ev.exit(ref.id, exitCode)
  })
}

export const writePty = (id: string, d: string): void => ptys.get(id)?.p.write(d)
export const resizePty = (id: string, c: number, r: number): void => ptys.get(id)?.p.resize(c, r)
export const killPty = (id: string): void => {
  const p = ptys.get(id)?.p
  ptys.delete(id)
  if (!p) return
  p.kill()
  // claude que ignora SIGHUP vira processo invisível; 3s depois vai no SIGKILL
  setTimeout(() => {
    if (exited.has(p)) return // já saiu: o pid pode ter sido reciclado por outro processo
    try {
      process.kill(p.pid, 'SIGKILL')
    } catch {
      // já saiu
    }
  }, 3000)
}
export const alivePtys = (): string[] => [...ptys.keys()]
export const ownPids = (): Set<number> => new Set([...ptys.values()].map((e) => e.p.pid))
export const killAll = (): void => [...ptys.keys()].forEach(killPty)

export function renamePty(from: string, to: string): boolean {
  const e = ptys.get(from)
  if (!e || ptys.has(to)) return false
  ptys.delete(from)
  e.ref.id = to
  ptys.set(to, e)
  return true
}
