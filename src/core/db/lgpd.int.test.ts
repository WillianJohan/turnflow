import { statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { DomainChanged } from '../../shared/ipc/events'
import { insertCheckpoint, insertTask, openTestDb, tmpDir } from '../testing/db'
import type { Db } from './open'
import { compact, purgeTask } from './purge'
import { runSearch } from './search'
import { createTx } from './tx'

const SECRET = 'segredo-lgpd-xyz'

/** Banco em disco com uma task de 2 checkpoints com o segredo e outras tasks de enchimento. */
function seeded(): { db: Db; file: string; id: string } {
  const dir = tmpDir()
  const db = openTestDb(dir)
  const id = insertTask(db, { key: 'T-1', title: 'Pessoal', description: `nota ${SECRET}` })
  insertCheckpoint(db, { task_id: id, text: `primeiro ${SECRET}` })
  insertCheckpoint(db, { task_id: id, text: `segundo ${SECRET} ${'texto longo '.repeat(400)}` })
  for (let i = 0; i < 20; i++) {
    const t = insertTask(db, { key: `F-${i}`, title: `Outra ${i}` })
    insertCheckpoint(db, { task_id: t, text: `enchimento ${'abc '.repeat(300)}` })
  }
  return { db, file: join(dir, 'turnflow.db'), id }
}

const count = (db: Db, sql: string, ...args: unknown[]): number =>
  (db.prepare(sql).get(...args) as { n: number }).n

const noop = (): void => undefined

// Toca disco (tamanho do -wal), por isso .int.test.ts: é o lgpd.test.ts do plano.
describe('LGPD local', () => {
  it('secure_delete ligado', () => {
    const db = openTestDb()
    expect(db.pragma('secure_delete', { simple: true })).toBe(1)
    db.close()
  })

  it('purge limpa FTS e derivados', () => {
    const { db, id } = seeded()
    expect(runSearch(db, SECRET).length).toBeGreaterThan(0)
    expect(purgeTask(db, id, createTx(db, noop))).toBe(true)

    expect(runSearch(db, SECRET)).toEqual([])
    expect(count(db, 'select count(*) as n from checkpoint where task_id = ?', id)).toBe(0)
    expect(count(db, 'select count(*) as n from search_fts where task_id = ?', id)).toBe(0)
    db.exec("create virtual table temp.vocab using fts5vocab(main, 'search_fts', 'row')")
    // trigramas que só o segredo tinha
    expect(count(db, "select count(*) as n from temp.vocab where term in ('xyz', 'gpd')")).toBe(0)
    // o resto continua achável
    expect(runSearch(db, 'enchimento').length).toBeGreaterThan(0)
    db.close()
  })

  it('o vocabulário tinha os trigramas antes do purge (o teste acima não é vácuo)', () => {
    const { db } = seeded()
    db.exec("create virtual table temp.vocab using fts5vocab(main, 'search_fts', 'row')")
    expect(count(db, "select count(*) as n from temp.vocab where term in ('xyz', 'gpd')")).toBe(2)
    db.close()
  })

  it('WAL zerado depois do purge', () => {
    const { db, file, id } = seeded()
    expect(statSync(file + '-wal').size).toBeGreaterThan(0)
    purgeTask(db, id, createTx(db, noop))
    expect(statSync(file + '-wal').size).toBe(0)
    db.close()
  })

  it('freelist vazia depois do purge', () => {
    const { db, id } = seeded()
    db.prepare('delete from task where key like ?').run('F-1%') // páginas livres antes do purge
    db.pragma('wal_checkpoint(TRUNCATE)')
    expect(db.pragma('freelist_count', { simple: true })).toBeGreaterThan(0)
    purgeTask(db, id, createTx(db, noop))
    expect(db.pragma('freelist_count', { simple: true })).toBe(0)
    db.close()
  })

  it('domain.changed depois do commit, uma vez', () => {
    const { db, id } = seeded()
    const seen: { c: DomainChanged; exists: number }[] = []
    const after = vi.fn((c: DomainChanged) => {
      seen.push({ c, exists: count(db, 'select count(*) as n from task where id = ?', id) })
    })
    purgeTask(db, id, createTx(db, after))
    expect(after).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([{ c: { entity: 'task', ids: [id], op: 'delete' }, exists: 0 }])
    db.close()
  })

  it('task inexistente: false e sem emit', () => {
    const { db } = seeded()
    const after = vi.fn()
    expect(purgeTask(db, 'nao-existe', createTx(db, after))).toBe(false)
    expect(after).not.toHaveBeenCalled()
    db.close()
  })

  it('compact zera WAL e freelist', () => {
    const { db, file } = seeded()
    db.prepare('delete from task where key like ?').run('F-%')
    compact(db)
    expect(statSync(file + '-wal').size).toBe(0)
    expect(db.pragma('freelist_count', { simple: true })).toBe(0)
    db.close()
  })
})
