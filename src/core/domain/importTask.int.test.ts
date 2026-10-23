import { describe, expect, it, vi } from 'vitest'
import type { DomainChanged } from '../../shared/ipc/events'
import { purgeTask } from '../db/purge'
import type { Db } from '../db/open'
import { runSearch } from '../db/search'
import { openTestDb, seedIds } from '../testing/db'
import { readActivity } from './activity'
import { checkpointHash } from './checkpoint'
import { createDomain, type DomainDeps } from './context'
import { DomainError } from './errors'
import {
  appendLinks,
  importCreateTaskIn,
  importProjectIn,
  importUpdateTaskIn,
  type ImportSession,
  type ImportTaskCreate,
  type ImportWriteResult,
  type ImportTaskUpdate
} from './importTask'
import { listTasks, getTask } from './rows'
import { createTask, setStage } from './task'
import { listActivity } from './undo'

const NOW = '2026-10-22T12:00:00.000Z'

function setup(): {
  db: Db
  d: DomainDeps
  ids: ReturnType<typeof seedIds>
  after: ReturnType<typeof vi.fn<(c: DomainChanged) => void>>
} {
  const db = openTestDb()
  const after = vi.fn<(c: DomainChanged) => void>()
  const d = createDomain({ db, afterCommit: after, now: () => new Date(NOW) })
  return { db, d, ids: seedIds(db), after }
}

type Ids = ReturnType<typeof seedIds>
const base = (ids: Ids, over: Partial<ImportTaskCreate> = {}): ImportTaskCreate => ({
  key: 'ABC-1',
  title: 'Imported task',
  description: null,
  type_id: ids.types.Feature,
  flow_id: ids.flows.Feature,
  stage: { stage_id: ids.stages.Feature[1], blocked_reason: null },
  project_id: null,
  workdir: null,
  created_at: '2026-01-02T12:00:00.000Z',
  touched_at: '2026-01-02T12:00:00.000Z',
  checkpoints: [],
  sessions: [],
  ...over
})

const create = (d: DomainDeps, t: ImportTaskCreate): ImportWriteResult =>
  d.tx((emit) => importCreateTaskIn(d, emit, t))
const update = (d: DomainDeps, u: ImportTaskUpdate): ImportWriteResult =>
  d.tx((emit) => importUpdateTaskIn(d, emit, u))

const errOf = (fn: () => unknown): { code: string; reason: unknown } => {
  try {
    fn()
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, reason: e.details?.reason }
    throw e
  }
  throw new Error('não lançou')
}

const SID = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`
const sess = (n: number, label: string | null = null): ImportSession => ({
  external_id: SID(n),
  at: '2026-01-03T12:00:00.000Z',
  label
})

type TaskCols = Record<string, string | null>
const col = (db: Db, id: string): TaskCols =>
  db.prepare('select * from task where id = ?').get(id) as TaskCols
const count = (db: Db, sql: string, ...a: unknown[]): number =>
  (db.prepare(sql).get(...a) as { n: number }).n

describe('importCreateTaskIn', () => {
  it('cria com key, tipo, fluxo e etapa', () => {
    const { d, db, ids } = setup()
    create(d, base(ids))
    const row = listTasks(d, 'attention').find((r) => r.key === 'ABC-1')!
    expect(row.stage.position).toBe(2)
    const c = db.prepare('select type_id, flow_id, stage_id from task').get() as TaskCols
    expect(c.type_id).not.toBeNull()
    expect(c.flow_id).not.toBeNull()
    expect(c.stage_id).not.toBeNull()
  })

  it('datas do import: touched_at é o último checkpoint e etapa final conclui', () => {
    const { d, db, ids } = setup()
    const r = create(
      d,
      base(ids, {
        checkpoints: [
          { at: '2026-01-02T12:00:00.000Z', text: 'first' },
          { at: '2026-01-05T12:00:00.000Z', text: 'second' }
        ],
        touched_at: '2026-01-05T12:00:00.000Z'
      })
    )
    const c = col(db, r.task_id)
    expect(c.created_at).toBe('2026-01-02T12:00:00.000Z')
    expect(c.touched_at).toBe('2026-01-05T12:00:00.000Z')
    expect(c.done_at).toBeNull()

    const f = create(
      d,
      base(ids, {
        key: 'ABC-9',
        stage: { stage_id: ids.stages.Feature[3], blocked_reason: null },
        touched_at: '2026-01-05T12:00:00.000Z'
      })
    )
    expect(col(db, f.task_id).done_at).toBe('2026-01-05T12:00:00.000Z')
    expect(listTasks(d, { ids: [f.task_id] })[0].group).toBe('concluida')
  })

  it('checkpoints com source import e busca', () => {
    const { d, db, ids } = setup()
    const r = create(
      d,
      base(ids, {
        checkpoints: [{ at: '2026-01-02T12:00:00.000Z', text: 'a synthetic note here' }]
      })
    )
    const cps = getTask(d, r.task_id).checkpoints
    expect(cps.map((c) => c.source)).toEqual(['import'])
    expect(runSearch(db, 'synthetic note', 30).length).toBeGreaterThan(0)
    const h = db.prepare('select text_hash from checkpoint').get() as { text_hash: string }
    expect(h.text_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('sessão importada nasce encerrada e não liga a vez', () => {
    const { d, ids } = setup()
    const r = create(d, base(ids, { sessions: [sess(1, 'old chat')] }))
    const t = getTask(d, r.task_id)
    expect(t.sessions[0]).toMatchObject({
      external_id: SID(1),
      tool: 'claude-code',
      label: 'old chat'
    })
    expect(t.sessions[0].ended_at).not.toBeNull()
    expect(t.session).toBeNull()
    expect(t.group).not.toBe('sua_vez')
    expect(r.sessions_added).toBe(1)
  })

  it('uuid de outra task fica com a outra e volta em sessions_taken', () => {
    const { d, db, ids } = setup()
    create(d, base(ids, { sessions: [sess(1)] }))
    const r = create(d, base(ids, { key: 'ABC-2', sessions: [sess(1)] }))
    expect(r.sessions_taken).toEqual([{ external_id: SID(1), task_key: 'ABC-1' }])
    expect(r.sessions_added).toBe(0)
    const owner = db
      .prepare('select t.key from ai_session s join task t on t.id = s.task_id')
      .get() as { key: string }
    expect(owner.key).toBe('ABC-1')
  })

  it('bloqueada: motivo, blocked_at e grupo encaminhado', () => {
    const { d, db, ids } = setup()
    const r = create(
      d,
      base(ids, { stage: { stage_id: ids.stages.Feature[0], blocked_reason: 'waiting vendor' } })
    )
    const row = listTasks(d, { ids: [r.task_id] })[0]
    expect(row.group).toBe('encaminhado')
    expect(row.reason?.kind).toBe('bloqueada')
    const c = col(db, r.task_id)
    expect(c.blocked_reason).toBe('waiting vendor')
    expect(c.blocked_at).toBe(c.touched_at)
  })

  it('T-n sobe key_seq e o purge não faz reaproveitar', () => {
    const { d, db, ids } = setup()
    const r = create(d, base(ids, { key: 'T-50' }))
    purgeTask(db, r.task_id, d.tx)
    expect(createTask(d, { kind: 'user' }, { title: 'x' }).row!.key).toBe('T-51')
  })

  it('key com prefixo diferente não mexe no key_seq', () => {
    const { d, db, ids } = setup()
    create(d, base(ids, { key: 'ABC-50' }))
    expect(count(db, 'select count(*) as n from key_seq')).toBe(0)
  })

  it('sessão órfã é adotada sem erro de UNIQUE', () => {
    const { d, db, ids } = setup()
    db.prepare(
      `insert into ai_session(id, task_id, tool, external_id, state, state_at, started_at)
       values ('orphan', null, 'claude-code', ?, 'unknown', ?, ?)`
    ).run(SID(1), NOW, NOW)
    const r = create(d, base(ids, { sessions: [sess(1)] }))
    expect(r.sessions_added).toBe(1)
    const s = db.prepare("select task_id from ai_session where id = 'orphan'").get() as {
      task_id: string
    }
    expect(s.task_id).toBe(r.task_id)
    expect(count(db, 'select count(*) as n from ai_session')).toBe(1)
  })

  it('motivo de bloqueio longo: too_long e nenhuma linha nova', () => {
    const { d, db, ids } = setup()
    const e = errOf(() =>
      create(
        d,
        base(ids, {
          sessions: [sess(1)],
          stage: { stage_id: ids.stages.Feature[0], blocked_reason: 'x'.repeat(501) }
        })
      )
    )
    expect(e).toEqual({ code: 'VALIDATION', reason: 'too_long' })
    expect(count(db, 'select count(*) as n from task')).toBe(0)
    expect(count(db, 'select count(*) as n from ai_session')).toBe(0)
    expect(count(db, 'select count(*) as n from activity')).toBe(0)
  })

  it('etapa de outro fluxo: stage_not_in_flow e nenhuma linha nova', () => {
    const { d, db, ids } = setup()
    const e = errOf(() =>
      create(d, base(ids, { stage: { stage_id: ids.stages.Bugfix[0], blocked_reason: null } }))
    )
    expect(e).toEqual({ code: 'VALIDATION', reason: 'stage_not_in_flow' })
    expect(count(db, 'select count(*) as n from task')).toBe(0)
  })

  it('Atividade task_import: ator import, sem inverso nem client, não desfazível', () => {
    const { d, db, ids } = setup()
    const r = create(d, base(ids, { project_id: null }))
    const rows = db.prepare('select * from activity').all() as {
      op: string
      actor: string
      inverse: string | null
      client_id: string | null
    }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      op: 'task_import',
      actor: 'import',
      inverse: null,
      client_id: null
    })
    const a = readActivity(db, r.activity_id!)!
    expect(a.data).toMatchObject({ created: true, key: 'ABC-1' })
    expect(a.data.fields).toContain('stage_id')
    const l = listActivity(d, { task_id: r.task_id })
    expect(l[0].undoable).toBe(false)
    expect(l[0].summary).toBe('imported from markdown')
  })

  it('projeto: cria o project_item e emite project e flow', () => {
    const { d, db, ids, after } = setup()
    const pid = d.tx((emit) => importProjectIn(d, emit, { name: 'Epic' }))
    expect(db.prepare('select flow_id from project where id = ?').get(pid)).toEqual({
      flow_id: null
    })
    after.mockClear()
    const r = create(d, base(ids, { project_id: pid }))
    expect(count(db, 'select count(*) as n from project_item where task_id = ?', r.task_id)).toBe(1)
    const entities = after.mock.calls.map((c) => c[0].entity)
    expect(entities).toEqual(expect.arrayContaining(['task', 'project', 'flow', 'activity']))
  })

  it('nome de projeto longo vira too_long', () => {
    const { d } = setup()
    const e = errOf(() => d.tx((emit) => importProjectIn(d, emit, { name: 'n'.repeat(101) })))
    expect(e.reason).toBe('too_long')
  })
})

describe('importCreateTaskIn validações', () => {
  it('workdir relativo: workdir_relative', () => {
    const { d, db, ids } = setup()
    expect(errOf(() => create(d, base(ids, { workdir: 'rel/dir' })))).toEqual({
      code: 'VALIDATION',
      reason: 'workdir_relative'
    })
    expect(count(db, 'select count(*) as n from task')).toBe(0)
  })

  it('key duplicada: CONFLICT key_exists e nada novo', () => {
    const { d, db, ids } = setup()
    create(d, base(ids))
    expect(errOf(() => create(d, base(ids, { sessions: [sess(1)] })))).toEqual({
      code: 'CONFLICT',
      reason: 'key_exists'
    })
    expect(count(db, 'select count(*) as n from task')).toBe(1)
    expect(count(db, 'select count(*) as n from ai_session')).toBe(0)
  })
})

describe('importUpdateTaskIn', () => {
  it('não liga a vez: etapa para trás deixa turn_reason nulo', () => {
    const { d, db, ids } = setup()
    const r = create(
      d,
      base(ids, { stage: { stage_id: ids.stages.Feature[2], blocked_reason: null } })
    )
    update(d, {
      task_id: r.task_id,
      set: { stage: { stage_id: ids.stages.Feature[0], blocked_reason: null } }
    })
    expect(col(db, r.task_id).turn_reason).toBeNull()
    expect(col(db, r.task_id).stage_id).toBe(ids.stages.Feature[0])
  })

  it('Desfazer depois do import mostra mudou depois (por importação)', () => {
    const { d, db, ids } = setup()
    const r = create(d, base(ids))
    const s = setStage(d, { kind: 'user' }, { id: r.task_id, stage_id: ids.stages.Feature[2] })
    const w = update(d, {
      task_id: r.task_id,
      set: { stage: { stage_id: ids.stages.Feature[0], blocked_reason: null } }
    })
    const rows = listActivity(d, { task_id: r.task_id })
    const mine = rows.find((x) => x.id === s.activity_id)!
    expect(mine.undoable).toBe(false)
    expect(mine.undo_blocked_reason).toBe('mudou depois (por importação)')
    const fields = readActivity(db, w.activity_id!)!.data.fields
    expect(fields).toContain('stage_id')
    expect(fields).not.toContain('stage')
  })

  it('dedup e no-op: checkpoint com espaço e NFD não duplica; update vazio não escreve', () => {
    const { d, db, ids, after } = setup()
    const text = 'café note'
    const r = create(d, base(ids, { checkpoints: [{ at: '2026-01-02T12:00:00.000Z', text }] }))
    const u = update(d, {
      task_id: r.task_id,
      checkpoints: [{ at: '2026-01-02T15:00:00.000Z', text: ` ${text.normalize('NFD')}  ` }]
    })
    expect(u.checkpoints_added).toBe(0)
    expect(u.activity_id).toBeNull()
    expect(count(db, 'select count(*) as n from checkpoint')).toBe(1)

    after.mockClear()
    const changes = (db.prepare('select total_changes() as n').get() as { n: number }).n
    const e = update(d, { task_id: r.task_id })
    expect(e.activity_id).toBeNull()
    expect(after).toHaveBeenCalledTimes(0)
    expect((db.prepare('select total_changes() as n').get() as { n: number }).n).toBe(changes)
  })

  it('mesmo texto em outro dia entra; touched_at = max(atual, checkpoint novo)', () => {
    const { d, db, ids } = setup()
    const r = create(
      d,
      base(ids, { checkpoints: [{ at: '2026-01-02T12:00:00.000Z', text: 'same' }] })
    )
    const u = update(d, {
      task_id: r.task_id,
      checkpoints: [{ at: '2026-02-01T12:00:00.000Z', text: 'same' }]
    })
    expect(u.checkpoints_added).toBe(1)
    expect(col(db, r.task_id).touched_at).toBe('2026-02-01T12:00:00.000Z')
    update(d, {
      task_id: r.task_id,
      checkpoints: [{ at: '2026-01-10T12:00:00.000Z', text: 'older' }]
    })
    expect(col(db, r.task_id).touched_at).toBe('2026-02-01T12:00:00.000Z')
  })

  it('sessão: mesma task atualiza label, de outra task vai para taken', () => {
    const { d, db, ids } = setup()
    const a = create(d, base(ids, { sessions: [sess(1, 'one')] }))
    const b = create(d, base(ids, { key: 'ABC-2' }))
    const u1 = update(d, { task_id: a.task_id, sessions: [sess(1, 'renamed')] })
    expect(u1.sessions_added).toBe(0)
    expect(u1.activity_id).not.toBeNull()
    expect((db.prepare('select label from ai_session').get() as { label: string }).label).toBe(
      'renamed'
    )
    const u2 = update(d, { task_id: b.task_id, sessions: [sess(1, 'x')] })
    expect(u2.sessions_taken).toEqual([{ external_id: SID(1), task_key: 'ABC-1' }])
    const u3 = update(d, { task_id: a.task_id, sessions: [sess(1, 'renamed')] })
    expect(u3.activity_id).toBeNull()
  })

  it('sessão que reimporta sem label fica com label NULL', () => {
    const { d, db, ids } = setup()
    const r = create(d, base(ids, { sessions: [sess(1, 'named')] }))
    const u = update(d, { task_id: r.task_id, sessions: [sess(1, null)] })
    expect(u.activity_id).not.toBeNull()
    expect(db.prepare('select label from ai_session').get()).toEqual({ label: null })
  })

  it('órfã adotada mantém o label que já tinha', () => {
    const { d, db, ids } = setup()
    const r = create(d, base(ids))
    db.prepare(
      `insert into ai_session(id, task_id, tool, external_id, state, state_at, started_at, label)
       values ('keep', null, 'claude-code', ?, 'unknown', ?, ?, 'prev X')`
    ).run(SID(4), NOW, NOW)
    db.prepare(
      `insert into ai_session(id, task_id, tool, external_id, state, state_at, started_at)
       values ('fill', null, 'claude-code', ?, 'unknown', ?, ?)`
    ).run(SID(5), NOW, NOW)
    update(d, { task_id: r.task_id, sessions: [sess(4, 'scope'), sess(5, 'scope')] })
    expect(db.prepare("select label from ai_session where id = 'keep'").get()).toEqual({
      label: 'prev X'
    })
    expect(db.prepare("select label from ai_session where id = 'fill'").get()).toEqual({
      label: 'scope'
    })
  })

  it('sessão órfã é adotada no update', () => {
    const { d, db, ids } = setup()
    const r = create(d, base(ids))
    db.prepare(
      `insert into ai_session(id, task_id, tool, external_id, state, state_at, started_at)
       values ('orphan', null, 'claude-code', ?, 'unknown', ?, ?)`
    ).run(SID(2), NOW, NOW)
    const u = update(d, { task_id: r.task_id, sessions: [sess(2)] })
    expect(u.sessions_added).toBe(1)
    expect(
      (db.prepare("select task_id from ai_session where id = 'orphan'").get() as TaskCols).task_id
    ).toBe(r.task_id)
  })

  it('só muda o que mudou: título, descrição e fields em nome de coluna', () => {
    const { d, db, ids } = setup()
    const r = create(d, base(ids, { description: 'body' }))
    const u = update(d, { task_id: r.task_id, set: { title: 'New title', description: 'body' } })
    expect(u.fields).toEqual(['title'])
    expect(col(db, r.task_id).title).toBe('New title')
    const a = readActivity(db, u.activity_id!)!
    expect(a.data).toMatchObject({ created: false, key: 'ABC-1' })
  })

  it('stage recalcula done_at e blocked_at; mesma etapa não muda nada', () => {
    const { d, db, ids } = setup()
    const r = create(d, base(ids, { touched_at: '2026-01-02T12:00:00.000Z' }))
    const fin = { stage_id: ids.stages.Feature[3], blocked_reason: null }
    const u = update(d, {
      task_id: r.task_id,
      set: { stage: fin },
      checkpoints: [{ at: '2026-03-01T12:00:00.000Z', text: 'finish' }]
    })
    expect(u.fields).toEqual(expect.arrayContaining(['stage_id', 'done_at']))
    expect(col(db, r.task_id).done_at).toBe('2026-03-01T12:00:00.000Z')
    expect(update(d, { task_id: r.task_id, set: { stage: fin } }).activity_id).toBeNull()

    const blk = { stage_id: ids.stages.Feature[0], blocked_reason: 'waiting vendor' }
    const u2 = update(d, { task_id: r.task_id, set: { stage: blk } })
    expect(u2.fields).toEqual(
      expect.arrayContaining(['stage_id', 'done_at', 'blocked_reason', 'blocked_at'])
    )
    const c = col(db, r.task_id)
    expect(c.done_at).toBeNull()
    expect(c.blocked_at).toBe(c.touched_at)
    expect(update(d, { task_id: r.task_id, set: { stage: blk } }).activity_id).toBeNull()
  })

  it('reimport do mesmo bloqueio com checkpoint novo mantém blocked_at', () => {
    const { d, db, ids } = setup()
    const blk = { stage_id: ids.stages.Feature[0], blocked_reason: 'waiting vendor' }
    const r = create(d, base(ids, { stage: blk }))
    update(d, {
      task_id: r.task_id,
      set: { stage: blk },
      checkpoints: [{ at: '2026-03-01T12:00:00.000Z', text: 'later' }]
    })
    const c = col(db, r.task_id)
    expect(c.touched_at).toBe('2026-03-01T12:00:00.000Z')
    expect(c.blocked_at).toBe('2026-01-02T12:00:00.000Z')
  })

  it('etapa de outro fluxo no update: stage_not_in_flow', () => {
    const { d, ids } = setup()
    const r = create(d, base(ids))
    const e = errOf(() =>
      update(d, {
        task_id: r.task_id,
        set: { stage: { stage_id: ids.stages.Bugfix[0], blocked_reason: null } }
      })
    )
    expect(e.reason).toBe('stage_not_in_flow')
  })

  it('workdir só entra se a task está sem', () => {
    const { d, db, ids } = setup()
    const r = create(d, base(ids))
    update(d, { task_id: r.task_id, workdir: '/work/a' })
    expect(col(db, r.task_id).workdir).toBe('/work/a')
    const u = update(d, { task_id: r.task_id, workdir: '/work/b' })
    expect(col(db, r.task_id).workdir).toBe('/work/a')
    expect(u.activity_id).toBeNull()
  })

  it('projeto: update troca o item e null remove', () => {
    const { d, db, ids } = setup()
    const p1 = d.tx((emit) => importProjectIn(d, emit, { name: 'Epic' }))
    const p2 = d.tx((emit) => importProjectIn(d, emit, { name: 'Other' }))
    const r = create(d, base(ids, { project_id: p1 }))
    update(d, { task_id: r.task_id, set: { project_id: p2 } })
    const it = db.prepare('select project_id from project_item where task_id = ?').all(r.task_id)
    expect(it).toEqual([{ project_id: p2 }])
    expect(col(db, r.task_id).project_id).toBe(p2)
    const u = update(d, { task_id: r.task_id, set: { project_id: null } })
    expect(u.fields).toEqual(['project_id'])
    expect(count(db, 'select count(*) as n from project_item where task_id = ?', r.task_id)).toBe(0)
    expect(col(db, r.task_id).project_id).toBeNull()
  })

  it('append_links acrescenta ao bloco Links e respeita o limite', () => {
    const { d, db, ids } = setup()
    const r = create(d, base(ids, { description: 'body' }))
    const u = update(d, {
      task_id: r.task_id,
      append_links: ['- repo => https://example.com/mr/1']
    })
    expect(u.fields).toEqual(['description'])
    expect(col(db, r.task_id).description).toBe(
      'body\n\n## Links\n\n- repo => https://example.com/mr/1'
    )
    const big = create(d, base(ids, { key: 'ABC-3', description: 'x'.repeat(100_000) }))
    expect(
      errOf(() => update(d, { task_id: big.task_id, append_links: ['- a => https://example.com'] }))
        .reason
    ).toBe('too_long')
  })
})

describe('checkpointHash', () => {
  it('ignora espaço nas pontas e a forma Unicode', () => {
    expect(checkpointHash('  caf\u0065\u0301 ')).toBe(checkpointHash('caf\u00e9'))
    expect(checkpointHash('a')).not.toBe(checkpointHash('b'))
  })
})

describe('appendLinks', () => {
  it('com Links no meio, entra no bloco e antes da próxima seção', () => {
    const cur = 'intro\n\n## Links\n\n- a => https://example.com/1\n\n## Notes\n\ntext\n'
    expect(appendLinks(cur, ['- b => https://example.com/2'])).toBe(
      'intro\n\n## Links\n\n- a => https://example.com/1\n- b => https://example.com/2\n\n## Notes\n\ntext\n'
    )
  })

  it('cria o cabeçalho quando falta', () => {
    expect(appendLinks('body', ['- repo => https://example.com/mr/1'])).toBe(
      'body\n\n## Links\n\n- repo => https://example.com/mr/1'
    )
    expect(appendLinks(null, ['- a'])).toBe('## Links\n\n- a')
  })

  it('com cabeçalho presente só acrescenta a linha', () => {
    const cur = 'body\n\n## Links\n\n- a => https://example.com/1\n'
    expect(appendLinks(cur, ['- b => https://example.com/2'])).toBe(
      'body\n\n## Links\n\n- a => https://example.com/1\n- b => https://example.com/2'
    )
  })

  it('sem linhas devolve a descrição', () => {
    expect(appendLinks('body', [])).toBe('body')
    expect(appendLinks(null, [])).toBe('')
  })
})
