import { describe, expect, it } from 'vitest'
import { keyPragma } from './open'
import { createQueryTimer, instrumentDb, type QueryTimer } from './timing'
import { TEST_DEK, openTestDb } from '../testing/db'

type Line = ['warn' | 'error', string]
const setup = (
  mode: 'dev' | 'prod'
): { lines: Line[]; timer: QueryTimer; clock: { t: number; step: number }; now: () => number } => {
  const lines: Line[] = []
  const timer = createQueryTimer({ mode, log: (l, s) => lines.push([l, s]) })
  // Relógio fake: cada chamada a now() avança `step`; a duração medida é o passo.
  const clock = { t: 0, step: 0 }
  const now = (): number => {
    const v = clock.t
    clock.t += clock.step
    return v
  }
  return { lines, timer, clock, now }
}

describe('instrumentDb', () => {
  const SELECT = 'select * from secret where name = ?'

  it('dev loga acima do limiar sem parâmetros', () => {
    const { lines, timer, clock, now } = setup('dev')
    const db = openTestDb()
    instrumentDb(db, timer, now)
    const st = db.prepare(SELECT)
    clock.step = 20
    st.get('jira-token-x')
    expect(lines).toHaveLength(1)
    expect(lines[0][0]).toBe('warn')
    expect(lines[0][1]).toContain(SELECT)
    expect(lines[0][1]).not.toContain('jira-token-x')
    clock.step = 60
    st.get('jira-token-x')
    expect(lines[1][0]).toBe('error')
    clock.step = 10
    st.get('jira-token-x')
    expect(lines).toHaveLength(2)
    db.close()
  })

  it('prod só loga acima de 50 ms', () => {
    const { lines, timer, clock, now } = setup('prod')
    const db = openTestDb()
    instrumentDb(db, timer, now)
    const st = db.prepare(SELECT)
    clock.step = 20
    st.get('x')
    expect(lines).toHaveLength(0)
    clock.step = 60
    st.get('x')
    expect(lines.map((l) => l[0])).toEqual(['error'])
    db.close()
  })

  it('nome cortado em 80', () => {
    const { timer } = setup('dev')
    timer.record(`select ${'a'.repeat(200)}`, 1)
    expect(timer.stats()[0].name.length).toBe(80)
  })

  it('histograma', () => {
    const { timer, clock, now } = setup('dev')
    const db = openTestDb()
    instrumentDb(db, timer, now)
    const st = db.prepare('select 1')
    for (const ms of [0.5, 5, 60]) {
      clock.step = ms
      st.get()
    }
    const s = timer.stats().find((x) => x.name === 'select 1')!
    expect(s.count).toBe(3)
    expect(s.buckets).toEqual({ '<1': 1, '1-4': 0, '4-16': 1, '16-50': 0, '>50': 1 })
    expect(s.maxMs).toBe(60)
    db.close()
  })

  it('não muda o resultado', () => {
    const plain = openTestDb()
    const inst = openTestDb()
    instrumentDb(inst, setup('dev').timer)
    for (const db of [plain, inst]) db.exec('create table t(n integer)')
    const out = [plain, inst].map((db) => {
      const ins = db.prepare('insert into t(n) values (?)')
      const r = [1, 2, 3, 4].map((n) => ins.run(n))
      const all = db.prepare('select n from t order by n').all()
      const get = db.prepare('select n from t where n = ?').get(3)
      const partial: unknown[] = []
      for (const row of db.prepare('select n from t order by n').iterate()) {
        partial.push(row)
        if (partial.length === 2) break
      }
      const full = [...db.prepare('select n from t order by n').iterate()]
      return { r, all, get, partial, full }
    })
    expect(out[1]).toEqual(out[0])
    plain.close()
    inst.close()
  })

  it('PRAGMA key nunca vira nome de query', () => {
    const { lines, timer, clock, now } = setup('dev')
    clock.step = 100
    const db = openTestDb()
    instrumentDb(db, timer, now)
    const hex = TEST_DEK.toString('hex')
    // db.pragma() usa o prepare nativo (não passa pelo embrulho); o caso real é db.prepare("PRAGMA ...").
    db.pragma(keyPragma(TEST_DEK))
    db.prepare(`PRAGMA key="x'${hex}'"`).get()
    db.prepare(`PRAGMA main.hexkey='${hex}'`).get()
    db.prepare(`-- c\n  PRAGMA key="x'${hex}'"`).get()
    db.prepare(`/* c */ pragma main.key="x'${hex}'"`).get()
    // rekey trocaria a chave do banco aberto: só o timer, direto.
    timer.record(`/* c */ pragma main.rekey="x'${hex}'"`, 100)
    timer.record(`PRAGMA key = "x'${hex}'"`, 100)
    expect(timer.stats().some((s) => /key/i.test(s.name))).toBe(false)
    expect(lines.some((l) => l[1].includes(hex))).toBe(false)
    db.close()
  })

  it('iterate é registrado no timer', () => {
    const { timer, clock, now } = setup('dev')
    const db = openTestDb()
    instrumentDb(db, timer, now)
    clock.step = 5
    for (const _ of db.prepare('select 1 as n').iterate()) void _
    const s = timer.stats().find((x) => x.name === 'select 1 as n')
    expect(s?.count).toBe(1)
    db.close()
  })

  it('erro do SQLite continua propagando', () => {
    const { timer } = setup('dev')
    const db = openTestDb()
    instrumentDb(db, timer)
    db.exec('create table u(n integer primary key)')
    const ins = db.prepare('insert into u(n) values (?)')
    ins.run(1)
    expect(() => ins.run(1)).toThrowError(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })
    )
    db.close()
  })

  it('log que lança não quebra a query nem perde o write', () => {
    const timer = createQueryTimer({
      mode: 'dev',
      log: () => {
        throw new Error('log quebrou')
      }
    })
    const clock = { t: 0 }
    const db = openTestDb()
    instrumentDb(db, timer, () => (clock.t += 100))
    db.exec('create table w(n integer)')
    expect(db.prepare('select 7 as n').get()).toEqual({ n: 7 })
    expect(() => db.prepare('insert into w(n) values (?)').run(1)).not.toThrow()
    expect(db.prepare('select count(*) as c from w').get()).toEqual({ c: 1 })
    db.close()
  })
})
