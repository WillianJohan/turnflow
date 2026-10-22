import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb, type Db } from '../open'
import { migrate } from '../migrate'
import { LATEST, MIGRATIONS } from './index'
import {
  TEST_DEK,
  insertMcpClient,
  insertSession,
  insertTask,
  openTestDb,
  seedIds,
  tmpDir
} from '../../testing/db'

const STAGES = {
  Feature: [
    ['Refinamento', 'Ref.', 0, 0],
    ['Implementação', 'Impl.', 0, 0],
    ['Review', 'Review', 1, 0],
    ['Entregue', 'Entr.', 0, 1]
  ],
  Bugfix: [
    ['Reproduzir', 'Repr.', 0, 0],
    ['Corrigir', 'Corr.', 0, 0],
    ['Review', 'Review', 1, 0],
    ['Entregue', 'Entr.', 0, 1]
  ],
  Pessoal: [
    ['A fazer', 'A fazer', 0, 0],
    ['Fazendo', 'Fazendo', 0, 0],
    ['Feito', 'Feito', 0, 1]
  ]
} as const

const cols = (db: Db, t: string): string[] =>
  (db.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name)

const code = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    return (e as { code?: string }).code ?? 'sem-code'
  }
  return 'não lançou'
}

describe('migration 0004 domain', () => {
  it('chega em LATEST = 4', () => {
    const db = openTestDb()
    expect(LATEST).toBe(4)
    expect(db.pragma('user_version', { simple: true })).toBe(4)
    db.close()
  })

  it('semente dos 3 fluxos', () => {
    const db = openTestDb()
    const ids = seedIds(db)
    for (const n of ['Feature', 'Bugfix', 'Pessoal'] as const) {
      const rows = db
        .prepare(
          'select name, short_name, waits_other, is_final from flow_stage where flow_id = ? order by position'
        )
        .all(ids.flows[n]) as Record<string, unknown>[]
      expect(rows.map((r) => [r.name, r.short_name, r.waits_other, r.is_final])).toEqual(
        STAGES[n].map((s) => [...s])
      )
      const pos = db
        .prepare('select position from flow_stage where flow_id = ? order by position')
        .all(ids.flows[n]) as { position: number }[]
      expect(pos.map((p) => p.position)).toEqual(STAGES[n].map((_, i) => i + 1))
    }
    db.close()
  })

  it('tipos e fluxo padrão', () => {
    const db = openTestDb()
    const ids = seedIds(db)
    const t = (n: string): Record<string, unknown> =>
      db.prepare('select * from task_type where name = ?').get(n) as Record<string, unknown>
    expect(t('Feature').syncs).toBe(1)
    expect(t('Bugfix').syncs).toBe(1)
    expect(t('Pessoal').syncs).toBe(0)
    expect([t('Feature').icon, t('Bugfix').icon, t('Pessoal').icon]).toEqual([
      'sparkles',
      'bug',
      'user'
    ])
    for (const n of ['Feature', 'Bugfix', 'Pessoal'] as const) {
      expect(t(n).flow_id).toBe(ids.flows[n])
      expect(
        (db.prepare('select name from flow where id = ?').get(ids.flows[n]) as { name: string })
          .name
      ).toBe(n)
    }
    const def = db.prepare('select id from flow where is_default = 1').all() as { id: string }[]
    expect(def).toEqual([{ id: ids.flows.Feature }])
    db.close()
  })

  it('default único', () => {
    const db = openTestDb()
    expect(
      code(() => db.prepare("insert into flow(id, name, is_default) values ('x', 'X', 1)").run())
    ).toBe('SQLITE_CONSTRAINT_UNIQUE')
    db.close()
  })

  it('Pessoal nunca ganha outbox', () => {
    const db = openTestDb()
    const ids = seedIds(db)
    const mk = (key: string, n: 'Feature' | 'Pessoal'): string =>
      insertTask(db, {
        key,
        type_id: ids.types[n],
        flow_id: ids.flows[n],
        stage_id: ids.stages[n][0]
      })
    const pessoal = mk('T-1', 'Pessoal')
    const feature = mk('T-2', 'Feature')
    const ins = (task: string, k: string): void => {
      db.prepare(
        "insert into sync_outbox(id, task_id, op, payload, idem_key, created_at) values (?, ?, 'transition', '{}', ?, ?)"
      ).run(k, task, k, new Date().toISOString())
    }
    expect(() => ins(pessoal, 'a')).toThrow(/personal_no_sync/)
    expect(() => ins(feature, 'b')).not.toThrow()
    expect(
      (db.prepare('select attempts from sync_outbox').get() as { attempts: number }).attempts
    ).toBe(0)
    db.close()
  })

  it('colunas da §4', () => {
    const db = openTestDb()
    expect(cols(db, 'project_item').sort()).toEqual(
      ['id', 'project_id', 'rank', 'kind', 'task_id', 'label', 'due_date'].sort()
    )
    expect(cols(db, 'ai_session').sort()).toEqual(
      [
        'id',
        'task_id',
        'tool',
        'external_id',
        'cwd',
        'state',
        'state_at',
        'started_at',
        'ended_at',
        'label'
      ].sort()
    )
    expect(cols(db, 'mcp_client').sort()).toEqual(
      [
        'id',
        'kind',
        'name',
        'token_hash',
        'ai_session_id',
        'scopes',
        'last_used_at',
        'revoked_at'
      ].sort()
    )
    expect(cols(db, 'activity').sort()).toEqual(
      [
        'id',
        'at',
        'actor',
        'client_id',
        'op',
        'task_id',
        'inverse',
        'data',
        'undone_at',
        'undone_by_activity_id'
      ].sort()
    )
    expect(cols(db, 'sync_outbox').sort()).toEqual(
      [
        'id',
        'task_id',
        'op',
        'payload',
        'idem_key',
        'attempts',
        'next_at',
        'locked_at',
        'last_error',
        'done_at',
        'cancelled_at',
        'created_at'
      ].sort()
    )
    expect(cols(db, 'key_seq').sort()).toEqual(['last', 'prefix'])
    db.close()
  })

  it('NOT NULL e FKs das tabelas novas', () => {
    const db = openTestDb()
    const notnull = (t: string): string[] =>
      (
        db.prepare(`pragma table_info(${t})`).all() as {
          name: string
          notnull: number
          pk: number
        }[]
      )
        .filter((c) => c.notnull === 1 && c.pk === 0)
        .map((c) => c.name)
        .sort()
    const fks = (t: string): string[] =>
      (
        db.prepare(`pragma foreign_key_list(${t})`).all() as {
          from: string
          table: string
          on_delete: string
        }[]
      )
        .map((f) => `${f.from}>${f.table}:${f.on_delete}`)
        .sort()
    expect(notnull('project_item')).toEqual(['kind', 'project_id', 'rank'])
    expect(notnull('ai_session')).toEqual(['started_at', 'state', 'state_at', 'tool'])
    expect(notnull('mcp_client')).toEqual(['kind'])
    expect(notnull('activity')).toEqual(['actor', 'at', 'op'])
    expect(notnull('sync_outbox')).toEqual(['attempts', 'created_at', 'idem_key', 'op', 'task_id'])
    expect(notnull('key_seq')).toEqual(['last'])
    expect(fks('project_item')).toEqual(['project_id>project:CASCADE', 'task_id>task:CASCADE'])
    expect(fks('ai_session')).toEqual(['task_id>task:SET NULL'])
    expect(fks('mcp_client')).toEqual(['ai_session_id>ai_session:NO ACTION'])
    expect(fks('activity')).toEqual([
      'client_id>mcp_client:NO ACTION',
      'task_id>task:CASCADE',
      'undone_by_activity_id>activity:NO ACTION'
    ])
    expect(fks('sync_outbox')).toEqual(['task_id>task:CASCADE'])
    db.close()
  })

  it('enums e idem_key únicos', () => {
    const db = openTestDb()
    const t = insertTask(db, { key: 'T-1' })
    const at = '2026-10-22T00:00:00Z'
    const session = (state: string): unknown =>
      db
        .prepare(
          "insert into ai_session(id, tool, state, state_at, started_at) values (?, 'claude', ?, ?, ?)"
        )
        .run(state, state, at, at)
    const activity = (actor: string): unknown =>
      db
        .prepare("insert into activity(id, at, actor, op, task_id) values (?, ?, ?, 'x', ?)")
        .run(actor, at, actor, t)
    const outbox = (id: string, op: string, idem: string): unknown =>
      db
        .prepare(
          'insert into sync_outbox(id, task_id, op, idem_key, created_at) values (?, ?, ?, ?, ?)'
        )
        .run(id, t, op, idem, at)
    expect(code(() => session('dormindo'))).toBe('SQLITE_CONSTRAINT_CHECK')
    expect(code(() => session('idle'))).toBe('não lançou')
    expect(code(() => activity('robo'))).toBe('SQLITE_CONSTRAINT_CHECK')
    expect(code(() => activity('user'))).toBe('não lançou')
    // Atividade sem task (ex.: apagar projeto)
    expect(
      code(() =>
        db
          .prepare(
            "insert into activity(id, at, actor, op, task_id) values ('sem-task', ?, 'user', 'project_delete', null)"
          )
          .run(at)
      )
    ).toBe('não lançou')
    expect(code(() => outbox('o1', 'delete', 'k1'))).toBe('SQLITE_CONSTRAINT_CHECK')
    expect(code(() => outbox('o2', 'comment', 'k2'))).toBe('não lançou')
    expect(code(() => outbox('o3', 'comment', 'k2'))).toBe('SQLITE_CONSTRAINT_UNIQUE')
    db.close()
  })

  it('project_item: task única e kind validado', () => {
    const db = openTestDb()
    db.prepare("insert into project(id, name) values ('p', 'P')").run()
    const t = insertTask(db, { key: 'T-1' })
    const ins = (id: string, kind: string, task: string | null): void => {
      db.prepare(
        'insert into project_item(id, project_id, rank, kind, task_id) values (?, ?, ?, ?, ?)'
      ).run(id, 'p', 'a0', kind, task)
    }
    ins('i1', 'task', t)
    expect(code(() => ins('i2', 'task', t))).toBe('SQLITE_CONSTRAINT_UNIQUE')
    expect(code(() => ins('i3', 'outro', null))).toBe('SQLITE_CONSTRAINT_CHECK')
    db.close()
  })

  it('insertTask com tipo', () => {
    const db = openTestDb()
    const ids = seedIds(db)
    const id = insertTask(db, {
      key: 'T-1',
      type_id: ids.types.Pessoal,
      flow_id: ids.flows.Pessoal,
      stage_id: ids.stages.Pessoal[0]
    })
    const r = db.prepare('select * from task where id = ?').get(id) as Record<string, unknown>
    expect([r.type_id, r.flow_id, r.stage_id]).toEqual([
      ids.types.Pessoal,
      ids.flows.Pessoal,
      ids.stages.Pessoal[0]
    ])
    expect(r.touched_at).toBe(r.created_at)
    db.close()
  })

  it('insertTask com só parte do tipo lança', () => {
    const db = openTestDb()
    expect(() => insertTask(db, { key: 'T-1', type_id: 'x' })).toThrow(/juntos/)
    db.close()
  })

  it('mcp_client CHECK e helpers de sessão', () => {
    const db = openTestDb()
    expect(
      code(() =>
        db.prepare("insert into mcp_client(id, kind, name) values ('s', 'session', 'x')").run()
      )
    ).toBe('SQLITE_CONSTRAINT_CHECK')
    expect(code(() => insertMcpClient(db))).toBe('não lançou')
    const s = insertSession(db, { task_id: null, state: 'idle', state_at: '2026-10-22T00:00:00Z' })
    db.prepare(
      "insert into mcp_client(id, kind, name, ai_session_id) values ('s', 'session', 'x', ?)"
    ).run(s)
    expect(
      code(() =>
        db
          .prepare(
            "insert into ai_session(id, tool, external_id, state_at, started_at) values ('z', 'claude', ?, 'a', 'a')"
          )
          .run(s)
      )
    ).toBe('SQLITE_CONSTRAINT_UNIQUE')
    db.close()
  })

  it('banco v3 migra para 4 com a task intacta', () => {
    const file = join(tmpDir(), 'v3.db')
    const db = openDb({ file, dek: TEST_DEK, create: true, migrations: MIGRATIONS.slice(0, 3) })
    expect(db.pragma('user_version', { simple: true })).toBe(3)
    const id = insertTask(db, { key: 'T-1', title: 'antiga' })
    expect(migrate(db, MIGRATIONS)).toEqual({ from: 3, to: 4 })
    expect(db.pragma('user_version', { simple: true })).toBe(4)
    const r = db.prepare('select key, title from task where id = ?').get(id)
    expect(r).toEqual({ key: 'T-1', title: 'antiga' })
    expect((db.prepare('select count(*) as n from flow').get() as { n: number }).n).toBe(4)
    db.close()
  })
})
