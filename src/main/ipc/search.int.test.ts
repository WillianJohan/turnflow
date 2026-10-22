import { describe, expect, it, vi } from 'vitest'
import { VAULT_COPY } from '../../shared/copy/vault'
import { VaultError } from '../../core/key/errors'
import type { Vault } from '../../core/key/vault'
import { insertTask, openTestDb } from '../../core/testing/db'
import type { Channel } from '../../shared/ipc/define'
import { searchQuery } from '../../shared/ipc/search'
import { handle, type Handler, type IpcLike } from './handle'
import { registerSearchIpc } from './search'

function setup(vault: Vault, log?: (msg: string) => void): (input: unknown) => Promise<unknown> {
  const invokes = new Map<string, (...a: unknown[]) => unknown>()
  const ipc = {
    handle: (name: string, fn: (...a: never[]) => unknown) => void invokes.set(name, fn as never),
    on: () => undefined
  } as unknown as IpcLike
  const h = <C extends Channel>(ch: C, fn: Handler<C>): void =>
    handle(ipc, ch, fn, { validateOutput: true, log })
  registerSearchIpc(h, { vault })
  return async (input) => invokes.get(searchQuery.name)!({ sender: { id: 1 } }, input)
}

describe('search.query', () => {
  it('locked devolve LOCKED', async () => {
    const vault = {
      db: () => {
        throw new VaultError('LOCKED')
      }
    } as unknown as Vault
    expect(await setup(vault)({ q: 'abc' })).toMatchObject({
      ok: false,
      error: { code: 'LOCKED' }
    })
  })

  it('erro desconhecido vira INTERNAL genérico, sem a mensagem crua', async () => {
    const vault = {
      db: () => {
        throw new Error('segredo-do-sqlite')
      }
    } as unknown as Vault
    const log = vi.fn()
    const r = (await setup(vault, log)({ q: 'abc' })) as {
      ok: boolean
      error: { code: string; message: string }
    }
    expect(r.ok).toBe(false)
    expect(r.error.code).toBe('INTERNAL')
    expect(r.error.message).toBe(VAULT_COPY.errors.INTERNAL)
    expect(r.error.message).not.toContain('segredo')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('segredo-do-sqlite'))
  })

  it('ready devolve os hits', async () => {
    const db = openTestDb()
    insertTask(db, { key: 'T-1', title: 'Migracao' })
    const vault = { db: () => db } as unknown as Vault
    expect(await setup(vault)({ q: 'migracao' })).toMatchObject({
      ok: true,
      data: [{ kind: 'task', key: 'T-1' }]
    })
    db.close()
  })
})
