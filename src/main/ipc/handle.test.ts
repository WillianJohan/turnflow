import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { VAULT_COPY } from '../../shared/copy/vault'
import { defineChannel } from '../../shared/ipc/define'
import { handle, IpcError, type IpcLike } from './handle'

// ipcMain de mentira: guarda os listeners pra chamar como o Electron chamaria
function fakeIpc(): IpcLike & {
  invoke(name: string, ...args: unknown[]): Promise<unknown>
  emit(name: string, ...args: unknown[]): void
} {
  const invokes = new Map<string, (...a: unknown[]) => unknown>()
  const ons = new Map<string, (...a: unknown[]) => unknown>()
  const event = { sender: { id: 1 } }
  return {
    handle: (name: string, fn: (...a: never[]) => unknown) => void invokes.set(name, fn as never),
    on: (name: string, fn: (...a: never[]) => unknown) => {
      ons.set(name, fn as never)
      return undefined as never
    },
    invoke: async (name, ...args) => invokes.get(name)!(event, ...args),
    emit: (name, ...args) => void ons.get(name)!(event, ...args)
  } as never
}

const echo = defineChannel(
  't:echo',
  z.object({ id: z.string() }).strict(),
  z.object({ id: z.string() })
)
const big = defineChannel(
  't:big',
  z.object({ d: z.string().max(1024 * 1024) }).strict(),
  z.boolean()
)

describe('handle (invoke)', () => {
  it('input inválido → VALIDATION e fn não é chamada', async () => {
    const ipc = fakeIpc()
    const fn = vi.fn()
    handle(ipc, echo, fn)
    const r = await ipc.invoke('t:echo', { id: 42 })
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(fn).not.toHaveBeenCalled()
  })
  it('campo extra é rejeitado (strict)', async () => {
    const ipc = fakeIpc()
    const fn = vi.fn()
    handle(ipc, echo, fn)
    const r = await ipc.invoke('t:echo', { id: 'a', x: 1 })
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(fn).not.toHaveBeenCalled()
  })
  it('argumento posicional a mais é rejeitado', async () => {
    const ipc = fakeIpc()
    const fn = vi.fn()
    handle(ipc, echo, fn)
    const r = await ipc.invoke('t:echo', { id: 'a' }, 'sobra')
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(fn).not.toHaveBeenCalled()
  })
  it('string acima de 1 MB é rejeitada no canal que limita', async () => {
    const ipc = fakeIpc()
    const fn = vi.fn(() => true)
    handle(ipc, big, fn)
    const r = await ipc.invoke('t:big', { d: 'x'.repeat(1024 * 1024 + 1) })
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(fn).not.toHaveBeenCalled()
    expect(await ipc.invoke('t:big', { d: 'x'.repeat(1024 * 1024) })).toEqual({
      ok: true,
      data: true
    })
  })
  it('fn que lança vira INTERNAL genérico; a mensagem crua só vai pro log', async () => {
    const ipc = fakeIpc()
    const log = vi.fn()
    handle(
      ipc,
      echo,
      () => {
        throw new Error('boom /caminho/secreto')
      },
      { log }
    )
    await expect(ipc.invoke('t:echo', { id: 'a' })).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: VAULT_COPY.errors.INTERNAL }
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom /caminho/secreto'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('t:echo'))
  })
  it('promise rejeitada também vira INTERNAL genérico', async () => {
    const ipc = fakeIpc()
    const log = vi.fn()
    handle(ipc, echo, async () => Promise.reject(new Error('async boom')), { log })
    expect(await ipc.invoke('t:echo', { id: 'a' })).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: VAULT_COPY.errors.INTERNAL }
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('async boom'))
  })
  it('lançar algo que não é Error também vira INTERNAL genérico', async () => {
    const ipc = fakeIpc()
    const log = vi.fn()
    handle(
      ipc,
      echo,
      () => {
        throw 'cru'
      },
      { log }
    )
    expect(await ipc.invoke('t:echo', { id: 'a' })).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: VAULT_COPY.errors.INTERNAL }
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('cru'))
  })
  it('IpcError carrega o código de domínio', async () => {
    const ipc = fakeIpc()
    handle(ipc, echo, () => {
      throw new IpcError('NOT_FOUND', 'task x não encontrada')
    })
    expect(await ipc.invoke('t:echo', { id: 'a' })).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'task x não encontrada' }
    })
  })
  it('IpcError com details chega no Result', async () => {
    const ipc = fakeIpc()
    handle(ipc, echo, () => {
      throw new IpcError('VALIDATION', 'x', { index: 4 })
    })
    expect(await ipc.invoke('t:echo', { id: 'a' })).toEqual({
      ok: false,
      error: { code: 'VALIDATION', message: 'x', details: { index: 4 } }
    })
  })
  it('ok → { ok: true, data }', async () => {
    const ipc = fakeIpc()
    handle(ipc, echo, (input) => ({ id: input.id + '!' }))
    expect(await ipc.invoke('t:echo', { id: 'a' })).toEqual({ ok: true, data: { id: 'a!' } })
  })
  it('output fora do contrato vira INTERNAL quando validateOutput', async () => {
    const ipc = fakeIpc()
    handle(ipc, echo, () => ({ id: 1 }) as never, { validateOutput: true })
    expect(await ipc.invoke('t:echo', { id: 'a' })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' }
    })
  })
  it('sem validateOutput o output passa direto', async () => {
    const ipc = fakeIpc()
    handle(ipc, echo, () => ({ id: 1 }) as never, { validateOutput: false })
    expect(await ipc.invoke('t:echo', { id: 'a' })).toEqual({ ok: true, data: { id: 1 } })
  })
  it('entrega o evento do Electron pra fn', async () => {
    const ipc = fakeIpc()
    const fn = vi.fn(() => ({ id: 'a' }))
    handle(ipc, echo, fn)
    await ipc.invoke('t:echo', { id: 'a' })
    expect(fn).toHaveBeenCalledWith({ id: 'a' }, { sender: { id: 1 } })
  })
})

const fire = defineChannel('t:fire', z.object({ d: z.string() }).strict(), z.void(), 'send')

describe('handle (send)', () => {
  it('payload inválido é descartado calado e contado como VALIDATION no log', () => {
    const ipc = fakeIpc()
    const fn = vi.fn()
    const log = vi.fn()
    handle(ipc, fire, fn, { log })
    ipc.emit('t:fire', { d: 1 })
    expect(fn).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('VALIDATION'))
  })
  it('payload válido chama fn', () => {
    const ipc = fakeIpc()
    const fn = vi.fn()
    handle(ipc, fire, fn)
    ipc.emit('t:fire', { d: 'x' })
    expect(fn).toHaveBeenCalledWith({ d: 'x' }, { sender: { id: 1 } })
  })
  it('fn que lança não derruba o listener', () => {
    const ipc = fakeIpc()
    const log = vi.fn()
    handle(
      ipc,
      fire,
      () => {
        throw new Error('boom')
      },
      { log }
    )
    expect(() => ipc.emit('t:fire', { d: 'x' })).not.toThrow()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('INTERNAL'))
  })
})
