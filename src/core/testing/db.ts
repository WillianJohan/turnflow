// Só testes importam este arquivo.
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../db/open'

export const TEST_DEK = Buffer.alloc(32, 7)

export function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'turnflow-test-'))
}

export function openTestDb(dir: string = tmpDir()): Db {
  return openDb({ file: join(dir, 'turnflow.db'), dek: TEST_DEK, create: true })
}

const now = (): string => new Date().toISOString()

/**
 * Insere a task. Sem `type_id/flow_id/stage_id` cria (se faltarem) um flow/stage/type `test-*`
 * fora do padrão (`is_default = 0`, para não colidir com a semente). `touched_at` = `created_at`
 * salvo se vier em `p`.
 */
export function insertTask(
  db: Db,
  p: {
    id?: string
    key: string
    title?: string
    description?: string
    deleted_at?: string | null
    type_id?: string
    flow_id?: string
    stage_id?: string
    project_id?: string | null
    touched_at?: string
  }
): string {
  const id = p.id ?? randomUUID()
  const given = [p.type_id, p.flow_id, p.stage_id].filter((v) => v !== undefined).length
  if (given !== 0 && given !== 3) throw new Error('passe type_id, flow_id e stage_id juntos')
  const custom = given === 3
  if (!custom) {
    db.prepare(
      "insert or ignore into flow(id, name, is_default) values ('test-flow', 'Teste', 0)"
    ).run()
    db.prepare(
      "insert or ignore into flow_stage(id, flow_id, position, name, short_name) values ('test-stage', 'test-flow', 0, 'Teste', 'Teste')"
    ).run()
    db.prepare(
      "insert or ignore into task_type(id, name, flow_id) values ('test-type', 'Teste', 'test-flow')"
    ).run()
  }
  const created = now()
  db.prepare(
    `insert into task(id, key, title, description, type_id, flow_id, stage_id, project_id, deleted_at, touched_at, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    p.key,
    p.title ?? 't',
    p.description ?? null,
    p.type_id ?? 'test-type',
    p.flow_id ?? 'test-flow',
    p.stage_id ?? 'test-stage',
    p.project_id ?? null,
    p.deleted_at ?? null,
    p.touched_at ?? created,
    created
  )
  return id
}

export function insertSession(
  db: Db,
  p: {
    task_id: string | null
    state: 'working' | 'waiting' | 'idle' | 'unknown'
    state_at: string
    ended_at?: string | null
    tool?: string
    /** `undefined` = o id da linha; `null` = sem id externo. */
    external_id?: string | null
    started_at?: string
    cwd?: string | null
    label?: string | null
  }
): string {
  const id = randomUUID()
  const external = p.external_id === undefined ? id : p.external_id
  db.prepare(
    `insert into ai_session(id, task_id, tool, external_id, cwd, state, state_at, started_at, ended_at, label)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    p.task_id,
    p.tool ?? 'claude-code',
    external,
    p.cwd ?? null,
    p.state,
    p.state_at,
    p.started_at ?? p.state_at,
    p.ended_at ?? null,
    p.label ?? null
  )
  return id
}

export function insertMcpClient(db: Db, name = 'cliente'): string {
  const id = randomUUID()
  db.prepare(
    "insert into mcp_client(id, kind, name, token_hash) values (?, 'client', ?, 'hash-fixo')"
  ).run(id, name)
  return id
}

type SeedName = 'Feature' | 'Bugfix' | 'Personal'

/** Ids da semente da migration 0004, por nome (etapas por `position`). */
export function seedIds(db: Db): {
  flows: Record<SeedName, string>
  types: Record<SeedName, string>
  stages: Record<SeedName, string[]>
} {
  const names: SeedName[] = ['Feature', 'Bugfix', 'Personal']
  const one = (sql: string, n: string): string => (db.prepare(sql).get(n) as { id: string }).id
  const flows = {} as Record<SeedName, string>
  const types = {} as Record<SeedName, string>
  const stages = {} as Record<SeedName, string[]>
  for (const n of names) {
    flows[n] = one('select id from flow where name = ?', n)
    types[n] = one('select id from task_type where name = ?', n)
    stages[n] = (
      db.prepare('select id from flow_stage where flow_id = ? order by position').all(flows[n]) as {
        id: string
      }[]
    ).map((r) => r.id)
  }
  return { flows, types, stages }
}

export function insertCheckpoint(db: Db, p: { task_id: string; text: string }): string {
  const id = randomUUID()
  db.prepare(
    "insert into checkpoint(id, task_id, at, text, source) values (?, ?, ?, ?, 'user')"
  ).run(id, p.task_id, now(), p.text)
  return id
}

export function dumpTables(db: Db, tables: string[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const t of tables) out[t] = db.prepare(`select * from "${t}" order by 1`).all()
  return out
}
