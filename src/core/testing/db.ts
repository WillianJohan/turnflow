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

/** Cria flow/stage/type mínimos se faltarem e insere a task nesse fluxo. */
export function insertTask(
  db: Db,
  p: { id?: string; key: string; title: string; description?: string; deleted_at?: string | null }
): string {
  const id = p.id ?? randomUUID()
  db.prepare(
    "insert or ignore into flow(id, name, is_default) values ('test-flow', 'Teste', 1)"
  ).run()
  db.prepare(
    "insert or ignore into flow_stage(id, flow_id, position, name, short_name) values ('test-stage', 'test-flow', 0, 'Teste', 'Teste')"
  ).run()
  db.prepare(
    "insert or ignore into task_type(id, name, flow_id) values ('test-type', 'Teste', 'test-flow')"
  ).run()
  db.prepare(
    `insert into task(id, key, title, description, type_id, flow_id, stage_id, deleted_at, created_at)
     values (?, ?, ?, ?, 'test-type', 'test-flow', 'test-stage', ?, ?)`
  ).run(id, p.key, p.title, p.description ?? null, p.deleted_at ?? null, now())
  return id
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
