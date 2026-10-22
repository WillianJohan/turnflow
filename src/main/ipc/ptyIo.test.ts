import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPtyGuard } from '../ptyGuard'
import { registerPtyIo } from './ptyIo'
import type { IpcLike } from './handle'

// ipcMain de mentira, chamado como o Electron chamaria: (event com sender.id, input)
type Call = (name: string, input: unknown) => unknown
function fakeIpc(): { ipc: IpcLike; from: (sender: number) => Call } {
  const fns = new Map<string, (...a: unknown[]) => unknown>()
  const ipc = {
    handle: (n: string, f: (...a: unknown[]) => unknown) => void fns.set(n, f),
    on: (n: string, f: (...a: unknown[]) => unknown) => void fns.set(n, f)
  } as unknown as IpcLike
  const from =
    (sender: number): Call =>
    (name, input) =>
      fns.get(name)!({ sender: { id: sender } }, input)
  return { ipc, from }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- tipo inferido dos mocks
function setup() {
  const guard = createPtyGuard()
  const pty = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    alive: vi.fn(() => ['t1'])
  }
  const onKill = vi.fn()
  const { ipc, from } = fakeIpc()
  registerPtyIo(ipc, { guard, pty, onKill })
  guard.register('t1', 1)
  return { guard, pty, onKill, owner: from(1), intruder: from(2) }
}

describe('registerPtyIo (guard pelo handler real)', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it('dono escreve, outro webContents é recusado e nada chega no pty', () => {
    const { pty, owner, intruder } = setup()
    intruder('pty:write', { id: 't1', data: 'rm -rf ~\r' })
    expect(pty.write).not.toHaveBeenCalled()
    owner('pty:write', { id: 't1', data: 'ls' })
    expect(pty.write).toHaveBeenCalledWith('t1', 'ls')
  })
  it('resize e kill também passam pelo guard', () => {
    const { pty, onKill, intruder, owner } = setup()
    intruder('pty:resize', { id: 't1', cols: 10, rows: 10 })
    intruder('pty:kill', { id: 't1' })
    expect(pty.resize).not.toHaveBeenCalled()
    expect(pty.kill).not.toHaveBeenCalled()
    owner('pty:kill', { id: 't1' })
    expect(pty.kill).toHaveBeenCalledWith('t1')
    expect(onKill).toHaveBeenCalledWith('t1')
  })
  it('kill libera o guard: depois disso nem o dono escreve', () => {
    const { pty, owner } = setup()
    owner('pty:kill', { id: 't1' })
    owner('pty:write', { id: 't1', data: 'x' })
    expect(pty.write).not.toHaveBeenCalled()
  })
  it('pty:send de intruso devolve false e não escreve', async () => {
    const { pty, intruder } = setup()
    expect(await intruder('pty:send', { id: 't1', data: 'oi' })).toEqual({ ok: true, data: false })
    vi.advanceTimersByTime(100)
    expect(pty.write).not.toHaveBeenCalled()
  })
  it('pty:send manda o texto e o Enter separado', async () => {
    const { pty, owner } = setup()
    expect(await owner('pty:send', { id: 't1', data: 'oi' })).toEqual({ ok: true, data: true })
    vi.advanceTimersByTime(60)
    expect(pty.write.mock.calls).toEqual([
      ['t1', 'oi'],
      ['t1', '\r']
    ])
  })
  it('pty:send recheca o guard antes do Enter atrasado', async () => {
    const { guard, pty, owner } = setup()
    await owner('pty:send', { id: 't1', data: 'oi' })
    guard.release('t1') // a aba foi fechada/adotada nesse meio tempo
    vi.advanceTimersByTime(60)
    expect(pty.write.mock.calls).toEqual([['t1', 'oi']])
  })
  it('payload inválido é descartado antes do guard', () => {
    const { pty, owner } = setup()
    owner('pty:write', { id: 't1', data: 'x'.repeat(1024 * 1024 + 1) })
    owner('pty:write', { id: 't1' })
    expect(pty.write).not.toHaveBeenCalled()
  })
})
