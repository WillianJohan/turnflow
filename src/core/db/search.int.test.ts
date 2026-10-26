import { describe, expect, it } from 'vitest'
import { HL_CLOSE, HL_OPEN } from '../../shared/ipc/search'
import { insertCheckpoint, insertTask, openTestDb } from '../testing/db'
import { runSearch } from './search'

describe('busca FTS5', () => {
  it('sem acento acha com acento', () => {
    const db = openTestDb()
    const t = insertTask(db, { key: 'T-1', title: 'Outra coisa' })
    insertCheckpoint(db, { task_id: t, text: 'migração do número' })
    const hits = runSearch(db, 'migracao')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'checkpoint', key: 'T-1', task_id: t })
    expect(hits[0].snippet).toContain(`${HL_OPEN}migração${HL_CLOSE}`)
    db.close()
  })

  it('2 caracteres usa o fallback', () => {
    const db = openTestDb()
    insertTask(db, { key: 'AB-123', title: 'Ajuste' })
    insertTask(db, { key: 'T-2', title: 'Outra' })
    expect(runSearch(db, 'AB').map((h) => h.key)).toEqual(['AB-123'])
    const aj = runSearch(db, 'aj')
    expect(aj).toHaveLength(1)
    expect(aj[0]).toMatchObject({ kind: 'task', title: 'Ajuste' })
    expect(aj[0].snippet).toBe(`${HL_OPEN}Aj${HL_CLOSE}uste`)
    db.close()
  })

  it('título e descrição', () => {
    const db = openTestDb()
    insertTask(db, { key: 'T-1', title: 'Algo', description: 'tem um gargalo escondido' })
    const hits = runSearch(db, 'gargalo')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'task', key: 'T-1' })
    expect(runSearch(db, 'algo')).toHaveLength(1)
    db.close()
  })

  it('edição reindexa', () => {
    const db = openTestDb()
    const t = insertTask(db, { key: 'T-1', title: 'X' })
    const c = insertCheckpoint(db, { task_id: t, text: 'primeira versao' })
    expect(runSearch(db, 'primeira')).toHaveLength(1)
    db.prepare('update checkpoint set text = ? where id = ?').run('segunda redacao', c)
    expect(runSearch(db, 'primeira')).toHaveLength(0)
    expect(runSearch(db, 'segunda')).toHaveLength(1)
    db.prepare('delete from checkpoint where id = ?').run(c)
    expect(runSearch(db, 'segunda')).toHaveLength(0)
    db.close()
  })

  it('task apagada (soft) some e volta', () => {
    const db = openTestDb()
    const t = insertTask(db, { key: 'T-1', title: 'Lembrete importante' })
    insertCheckpoint(db, { task_id: t, text: 'nota importante' })
    expect(runSearch(db, 'importante')).toHaveLength(2)
    db.prepare("update task set deleted_at = '2026-10-22' where id = ?").run(t)
    expect(runSearch(db, 'importante')).toHaveLength(0)
    expect(runSearch(db, 'lem')).toHaveLength(0)
    db.prepare('update task set deleted_at = null where id = ?').run(t)
    expect(runSearch(db, 'importante')).toHaveLength(2)
    db.close()
  })

  it('sintaxe FTS na consulta não quebra e vira texto literal', () => {
    const db = openTestDb()
    insertTask(db, { key: 'T-1', title: 'abc' })
    for (const q of ['"', 'a*b', 'NEAR(x y)', '-foo', 'col:abc', '%_\\', 'abc\0def', '\u0002abc'])
      expect(Array.isArray(runSearch(db, q)), q).toBe(true)
    insertTask(db, { key: 'T-2', title: 'um x*y literal' })
    expect(runSearch(db, 'x*y').map((h) => h.key)).toEqual(['T-2'])
    insertTask(db, { key: 'T-3', title: 'texto NEAR(abc aqui' })
    expect(runSearch(db, 'NEAR(abc').map((h) => h.key)).toEqual(['T-3'])
    insertTask(db, { key: 'T-4', title: 'aspa "solta aqui' })
    expect(runSearch(db, '"solta').map((h) => h.key)).toEqual(['T-4'])
    // controles não forjam destaque: viram espaço, o termo útil continua valendo
    const hits = runSearch(db, '\u0002abc\u0003')
    expect(hits.map((h) => h.key).sort()).toEqual(['T-1', 'T-3'])
    for (const h of hits) expect(h.snippet.split(HL_OPEN)).toHaveLength(2)
    expect(runSearch(db, 'abc\0def')).toEqual([])
    db.close()
  })

  it('hard delete da task leva os checkpoints da busca', () => {
    const db = openTestDb()
    const t = insertTask(db, { key: 'T-1', title: 'X' })
    insertCheckpoint(db, { task_id: t, text: 'nota efemera' })
    expect(runSearch(db, 'efemera')).toHaveLength(1)
    db.prepare('delete from task where id = ?').run(t)
    expect(runSearch(db, 'efemera')).toHaveLength(0)
    expect(db.prepare('select count(*) as n from search_fts').get()).toEqual({ n: 0 })
    db.close()
  })

  it('termos curtos misturados: 3+ vai pro FTS, só curtos cai no fallback', () => {
    const db = openTestDb()
    insertTask(db, { key: 'T-1', title: 'abc de fg' })
    insertTask(db, { key: 'T-2', title: 'ab cd' })
    insertTask(db, { key: 'T-3', title: 'abc outro' })
    // 'abc de': só 'abc' entra no FTS ('de' é descartado)
    expect(
      runSearch(db, 'abc de')
        .map((h) => h.key)
        .sort()
    ).toEqual(['T-1', 'T-3'])
    // 'ab cd': nenhum termo de 3+, LIKE pela frase inteira
    expect(runSearch(db, 'ab cd').map((h) => h.key)).toEqual(['T-2'])
    db.close()
  })

  it('% e _ no fallback são literais', () => {
    const db = openTestDb()
    insertTask(db, { key: 'T-1', title: 'a_b' })
    insertTask(db, { key: 'T-2', title: 'axb' })
    expect(runSearch(db, '_').map((h) => h.key)).toEqual(['T-1'])
    db.close()
  })

  it('limit', () => {
    const db = openTestDb()
    for (let i = 0; i < 40; i++) insertTask(db, { key: `T-${i}`, title: `repetida ${i}` })
    expect(runSearch(db, 'repetida', 30)).toHaveLength(30)
    expect(runSearch(db, 'repetida')).toHaveLength(30)
    db.close()
  })

  it('migration indexa o que já existia', async () => {
    const { openDb } = await import('./open')
    const { MIGRATIONS } = await import('./migrations')
    const { join } = await import('node:path')
    const { TEST_DEK, tmpDir } = await import('../testing/db')
    const file = join(tmpDir(), 'm.db')
    const old = openDb({ file, dek: TEST_DEK, create: true, migrations: MIGRATIONS.slice(0, 2) })
    const t = insertTask(old, { key: 'T-1', title: 'Antiga' })
    insertCheckpoint(old, { task_id: t, text: 'texto legado' })
    old.close()
    const db = openDb({ file, dek: TEST_DEK, create: false })
    expect(runSearch(db, 'legado')).toHaveLength(1)
    expect(runSearch(db, 'antiga')).toHaveLength(1)
    db.close()
  })
})

describe('busca marca concluída', () => {
  it('hit diz se a task está encerrada (FTS e fallback curto)', () => {
    const db = openTestDb()
    const open = insertTask(db, { key: 'T-1', title: 'gamma aberta' })
    const done = insertTask(db, { key: 'T-2', title: 'gamma fechada' })
    db.prepare('update task set done_at = ? where id = ?').run('2026-10-22T10:00:00.000Z', done)
    const byId = (q: string): Record<string, boolean> =>
      Object.fromEntries(runSearch(db, q).map((h) => [h.task_id, h.done]))
    expect(byId('gamma')).toEqual({ [open]: false, [done]: true })
    expect(byId('ga')).toEqual({ [open]: false, [done]: true })
    db.close()
  })
})
