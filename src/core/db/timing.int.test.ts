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
    db.pragma(keyPragma(TEST_DEK))
    timer.record(`PRAGMA key = "x'${TEST_DEK.toString('hex')}'"`, 100)
    timer.record(`pragma rekey="x'${TEST_DEK.toString('hex')}'"`, 100)
    expect(timer.stats().some((s) => /key/i.test(s.name))).toBe(false)
    expect(lines.some((l) => l[1].includes(TEST_DEK.toString('hex')))).toBe(false)
    db.close()
  })
})
