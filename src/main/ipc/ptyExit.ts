import type { PtyGuard } from '../ptyGuard'

type ExitDeps = {
  uuidOf: Map<string, string>
  alias: Map<string, string>
  guard: PtyGuard
  send: (ch: 'pty:exit' | 'pty:state', ...a: [string, number] | [string, 'idle']) => void
}

// PTY terminou: esquece uuid, libera o dono (senão o id fica preso ao webContents antigo),
// limpa os aliases que apontavam pra ele e avisa o renderer.
export function onPtyExit(d: ExitDeps, id: string, code: number): void {
  d.uuidOf.delete(id)
  d.guard.release(id)
  for (const [k, v] of d.alias) if (v === id) d.alias.delete(k)
  d.send('pty:exit', id, code)
  d.send('pty:state', id, 'idle')
}
