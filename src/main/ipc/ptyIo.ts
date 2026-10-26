import type { PtyGuard } from '../ptyGuard'
import { ptyKill, ptyResize, ptySend, ptyWrite } from '../../shared/ipc/pty'
import { handle, type IpcLike } from './handle'

type Deps = {
  guard: PtyGuard
  pty: {
    write(id: string, d: string): void
    resize(id: string, c: number, r: number): void
    kill(id: string): void
    alive(): string[]
  }
  onKill(id: string): void
}

const ENTER_DELAY_MS = 60

// Entrada no pty: só a webContents dona escreve, redimensiona ou mata (ptyGuard).
export function registerPtyIo(ipc: IpcLike, { guard, pty, onKill }: Deps): void {
  handle(ipc, ptyWrite, ({ id, data }, e) => {
    if (guard.canWrite(id, e.sender.id)) pty.write(id, data)
  })
  // rascunho: só limpa no renderer se a sessão ainda estava viva pra receber
  handle(ipc, ptySend, ({ id, data }, e) => {
    const can = (): boolean => guard.canWrite(id, e.sender.id) && pty.alive().includes(id)
    if (!can()) return false
    pty.write(id, data)
    // Enter separado: o claude fecha o paste antes. Rechecado: a aba pode ter mudado de dono.
    setTimeout(() => can() && pty.write(id, '\r'), ENTER_DELAY_MS)
    return true
  })
  handle(ipc, ptyResize, ({ id, cols, rows }, e) => {
    if (guard.canWrite(id, e.sender.id)) pty.resize(id, cols, rows)
  })
  handle(ipc, ptyKill, ({ id }, e) => {
    if (!guard.canWrite(id, e.sender.id)) return
    onKill(id)
    guard.release(id)
    pty.kill(id)
  })
}
