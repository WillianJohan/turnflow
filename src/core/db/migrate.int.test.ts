import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DbOpenError, openDb } from './open'
import { migrate, type Migration } from './migrate'
import { LATEST } from './migrations'
import { TEST_DEK, insertCheckpoint, insertTask, openTestDb, tmpDir } from '../testing/db'

const tabelas = (db: ReturnType<typeof openTestDb>): string[] =>
  (
    db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]
  ).map((r) => r.name)

const lista = (v3: () => void): Migration[] => [
  { version: 1, name: 'um', up: (db) => db.exec('create table t1(a)') },
  { version: 2, name: 'dois', up: (db) => db.exec('create table t2(a)') },
  {
    version: 3,
    name: 'tres',
    up: (db) => {
      db.exec('create table t3(a)')
      v3()
    }
  }
]

describe('migrate', () => {
  it('banco novo chega em LATEST com as tabelas do núcleo', () => {
    const db = openTestDb()
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST)
    const t = tabelas(db)
    for (const n of ['secret', 'task', 'checkpoint', 'flow', 'flow_stage', 'task_type', 'project'])
      expect(t).toContain(n)
    db.close()
  })

  it('falha no meio desfaz todas e dá pra repetir corrigido', () => {
    const file = join(tmpDir(), 'm.db')
    const quebra = lista(() => {
      throw new Error('boom')
    })
    expect.assertions(7)
    try {
      openDb({ file, dek: TEST_DEK, create: true, migrations: quebra })
    } catch (e) {
      expect((e as DbOpenError).code).toBe('MIGRATION_FAILED')
      expect((e as DbOpenError).details?.version).toBe(3)
    }
    const db = openDb({ file, dek: TEST_DEK, create: false, migrate: false })
    expect(db.pragma('user_version', { simple: true })).toBe(0)
    expect(tabelas(db)).not.toContain('t1')
    expect(tabelas(db)).not.toContain('t2')
    expect(tabelas(db)).not.toContain('t3')
    migrate(
      db,
      lista(() => {})
    )
    expect(db.pragma('user_version', { simple: true })).toBe(3)
    db.close()
  })

  it('banco mais novo é recusado sem executar nada', () => {
    const file = join(tmpDir(), 'n.db')
    const db = openDb({ file, dek: TEST_DEK, create: true })
    db.pragma(`user_version = ${LATEST + 1}`)
    db.close()
    let rodou = false
    const lst: Migration[] = [{ version: 1, name: 'x', up: () => (rodou = true) }]
    expect.assertions(3)
    try {
      openDb({ file, dek: TEST_DEK, create: false, migrations: lst })
    } catch (e) {
      expect((e as DbOpenError).code).toBe('NEWER_SCHEMA')
    }
    expect(rodou).toBe(false)
    const again = openDb({ file, dek: TEST_DEK, create: false, migrate: false })
    expect(again.pragma('user_version', { simple: true })).toBe(LATEST + 1)
    again.close()
  })

  it('beforeMigrate só roda quando há pendente', () => {
    const file = join(tmpDir(), 'b.db')
    const chamadas: [number, number][] = []
    const beforeMigrate = (_db: unknown, from: number, to: number): void => {
      chamadas.push([from, to])
    }
    openDb({ file, dek: TEST_DEK, create: true, beforeMigrate }).close()
    openDb({ file, dek: TEST_DEK, create: false, beforeMigrate }).close()
    expect(chamadas).toEqual([[0, LATEST]])
  })

  it('FK: checkpoint exige task e some junto com ela', () => {
    const db = openTestDb()
    expect(() => insertCheckpoint(db, { task_id: 'inexistente', text: 'x' })).toThrowError(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })
    )
    const id = insertTask(db, { key: 'T-1', title: 'a' })
    insertCheckpoint(db, { task_id: id, text: 'um' })
    db.prepare('delete from task where id = ?').run(id)
    expect(db.prepare('select count(*) as n from checkpoint').get()).toEqual({ n: 0 })
    db.close()
  })
})
