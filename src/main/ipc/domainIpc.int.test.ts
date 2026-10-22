import { describe, expect, it, vi } from 'vitest'
import { VAULT_COPY } from '../../shared/copy/vault'
import { VaultError } from '../../core/key/errors'
import type { Vault } from '../../core/key/vault'
import type { Db } from '../../core/db/open'
import { openTestDb, seedIds } from '../../core/testing/db'
import type { Channel } from '../../shared/ipc/define'
import type { DomainChanged } from '../../shared/ipc/events'
import { CHANNELS } from '../../shared/ipc/registry'
import type { Result } from '../../shared/ipc/result'
import type { TaskDetail, TaskRow } from '../../shared/contracts'
import { handle, type Handler, type IpcLike } from './handle'
import { registerDomainIpc } from './domain'

const T0 = Date.parse('2026-10-22T12:00:00.000Z')

type Call = (method: keyof typeof CHANNELS, input?: unknown) => Promise<Result<unknown>>

function setup(
  vault: Vault,
  o: { log?: (msg: string) => void; afterCommit?: (c: DomainChanged) => void } = {}
): Call {
  const invokes = new Map<string, (...a: unknown[]) => unknown>()
  const ipc = {
    handle: (name: string, fn: (...a: never[]) => unknown) => void invokes.set(name, fn as never),
    on: () => undefined
  } as unknown as IpcLike
  const h = <C extends Channel>(ch: C, fn: Handler<C>): void =>
    handle(ipc, ch, fn, { validateOutput: true, log: o.log })
  registerDomainIpc(h, {
    vault,
    now: () => new Date(T0),
    defaultWorkdir: () => null,
    afterCommit: o.afterCommit ?? (() => undefined)
  })
  return async (method, input) => {
    const fn = invokes.get(CHANNELS[method].name)
    if (!fn) throw new Error(`sem handler: ${method}`)
    const args = input === undefined ? [] : [input]
    return (await fn({ sender: { id: 1 } }, ...args)) as Result<unknown>
  }
}

function ready(): { db: Db; call: Call; afterCommit: ReturnType<typeof vi.fn> } {
  const db = openTestDb()
  const afterCommit = vi.fn()
  const call = setup({ db: () => db } as unknown as Vault, { afterCommit })
  return { db, call, afterCommit }
}

function data<T>(r: Result<unknown>): T {
  if (!r.ok) throw new Error(`esperava ok, veio ${r.error.code}: ${r.error.message}`)
  return r.data as T
}

async function create(call: Call, title = 'a'): Promise<TaskRow> {
  return data<{ row: TaskRow }>(await call('taskCreate', { title })).row
}

describe('canais do domínio', () => {
  it('locked devolve LOCKED', async () => {
    const vault = {
      db: () => {
        throw new VaultError('LOCKED')
      }
    } as unknown as Vault
    const call = setup(vault)
    expect(await call('taskList', { scope: 'attention' })).toMatchObject({
      ok: false,
      error: { code: 'LOCKED' }
    })
    expect(await call('taskCreate', { title: 'a' })).toMatchObject({
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
    const r = await setup(vault, { log })('attentionCounts')
    expect(r).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: VAULT_COPY.errors.INTERNAL }
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('segredo-do-sqlite'))
  })

  it('input inválido é VALIDATION sem exceção', async () => {
    const { call } = ready()
    const row = await create(call)
    for (const r of [
      await call('taskCreate', { title: '' }),
      await call('taskCreate', { title: 'a', extra: 1 }),
      await call('taskSetWorkdir', { id: row.id, workdir: 'rel' })
    ])
      expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })

  it('DomainError mantém o código', async () => {
    const { db, call } = ready()
    const s = seedIds(db)
    const row = await create(call)
    expect(await call('taskSetStage', { id: row.id, stage_id: s.stages.Bugfix[0] })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', details: { reason: 'stage_not_in_flow' } }
    })

    const project = data<{ id: string }>(
      await call('projectCreate', { name: 'P', flow_id: s.flows.Bugfix })
    )
    expect(await call('taskMove', { id: row.id, project_id: project.id })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', details: { choice: ['keep', 'adopt'] } }
    })

    expect(await call('taskGet', { id: 'T-99' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' }
    })
  })

  it('kanban: setStage pelo IPC não pede confirmação e gera Desfazer', async () => {
    const { db, call } = ready()
    const s = seedIds(db)
    const row = await create(call)
    const target = s.stages.Feature.find((id) => id !== row.stage.id)!
    const moved = data<{ activity_id: string | null; outbox: string }>(
      await call('taskSetStage', { id: row.id, stage_id: target })
    )
    expect(moved.activity_id).not.toBeNull()
    const acts = data<{ id: string; undoable: boolean }[]>(
      await call('activityList', { task_id: row.id })
    )
    expect(acts[0]).toMatchObject({ id: moved.activity_id, undoable: true })
    data(await call('activityUndo', { activity_id: moved.activity_id }))
    expect(data<TaskDetail>(await call('taskGet', { id: row.id })).stage.id).toBe(row.stage.id)
  })

  it('delete exige confirmed', async () => {
    const { call } = ready()
    const row = await create(call)
    expect(await call('taskDelete', { id: row.id })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    expect(await call('taskDelete', { id: row.id, confirmed: false })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    expect(data<TaskRow[]>(await call('taskList', { scope: { ids: [row.id] } }))).toHaveLength(1)

    expect(data(await call('taskDelete', { id: row.id, confirmed: true }))).toMatchObject({
      row: null
    })
    expect(data<TaskRow[]>(await call('taskList', { scope: { ids: [row.id] } }))).toEqual([])
  })

  it('project.delete exige confirmed', async () => {
    const { call } = ready()
    const p = data<{ id: string }>(await call('projectCreate', { name: 'P' }))
    expect(await call('projectDelete', { id: p.id })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    expect(data<{ id: string }[]>(await call('projectList'))).toHaveLength(1)
    expect(data(await call('projectDelete', { id: p.id, confirmed: true }))).toEqual({
      deleted: true,
      task_ids: []
    })
    expect(data<unknown[]>(await call('projectList'))).toEqual([])
  })

  it('domain.changed só depois do commit', async () => {
    const { call, afterCommit } = ready()
    const row = await create(call)
    const changes = afterCommit.mock.calls.map(([c]) => c as DomainChanged)
    expect(changes).toContainEqual({ entity: 'task', ids: [row.id], op: 'upsert' })
    expect(changes.some((c) => c.entity === 'activity' && c.op === 'upsert')).toBe(true)

    afterCommit.mockClear()
    expect(await call('taskCreate', { title: '' })).toMatchObject({ ok: false })
    expect(await call('taskBlock', { id: row.id, reason: '   ' })).toMatchObject({ ok: false })
    expect(afterCommit).not.toHaveBeenCalled()
  })

  it('task.get por key e por id devolvem o mesmo TaskDetail, dentro do contrato', async () => {
    const { call } = ready()
    const row = await create(call, 'primeira')
    const byId = data<TaskDetail>(await call('taskGet', { id: row.id }))
    const byKey = data<TaskDetail>(await call('taskGet', { id: row.key }))
    expect(byKey).toEqual(byId)
    expect(byId).toMatchObject({ id: row.id, key: 'T-1', title: 'primeira', group: 'pendente' })
  })

  it('leituras sem input passam no contrato', async () => {
    const { call } = ready()
    await create(call)
    expect(data(await call('attentionCounts'))).toEqual({
      sua_vez: 0,
      pendente: 1,
      encaminhado: 0,
      fila_projeto: 0
    })
    expect(data<unknown[]>(await call('flowList'))).toHaveLength(3)
    expect(data<unknown[]>(await call('taskTypeList'))).toHaveLength(3)
  })
})
