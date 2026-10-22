import { describe, expect, it } from 'vitest'
import type { DomainChanged } from '../../shared/ipc/events'
import { createTx } from './tx'
import { openTestDb } from '../testing/db'

describe('createTx', () => {
  it('emite só depois do commit, uma vez por emit', () => {
    const db = openTestDb()
    const vistos: DomainChanged[] = []
    const tx = createTx(db, (c) => vistos.push(c))
    tx((emit) => {
      emit({ entity: 'task', ids: ['a'], op: 'upsert' })
      emit({ entity: 'project', ids: ['b'], op: 'delete' })
      expect(vistos).toHaveLength(0)
    })
    expect(vistos).toEqual([
      { entity: 'task', ids: ['a'], op: 'upsert' },
      { entity: 'project', ids: ['b'], op: 'delete' }
    ])
    db.close()
  })

  it('rollback não emite e desfaz a escrita', () => {
    const db = openTestDb()
    const vistos: DomainChanged[] = []
    const tx = createTx(db, (c) => vistos.push(c))
    expect(() =>
      tx((emit) => {
        db.prepare('insert into secret(name, service, value, created_at) values (?,?,?,?)').run(
          'x',
          's',
          'v',
          't'
        )
        emit({ entity: 'task', ids: ['a'], op: 'upsert' })
        throw new Error('falhou')
      })
    ).toThrow('falhou')
    expect(vistos).toHaveLength(0)
    expect(db.prepare("select count(*) as n from secret where name = 'x'").get()).toEqual({ n: 0 })
    db.close()
  })

  it('devolve o retorno de fn', () => {
    const db = openTestDb()
    expect(createTx(db, () => {})(() => 7)).toBe(7)
    db.close()
  })

  it('listener que lança não perde eventos nem vira erro da escrita', () => {
    const db = openTestDb()
    const vistos: string[] = []
    const erros: unknown[] = []
    const tx = createTx(
      db,
      (c) => {
        vistos.push(c.ids[0])
        if (c.ids[0] === 'a') throw new Error('listener')
      },
      (e) => erros.push(e)
    )
    const r = tx((emit) => {
      db.prepare('insert into secret(name, service, value, created_at) values (?,?,?,?)').run(
        'y',
        's',
        'v',
        't'
      )
      emit({ entity: 'task', ids: ['a'], op: 'upsert' })
      emit({ entity: 'task', ids: ['b'], op: 'upsert' })
      return 5
    })
    expect(r).toBe(5)
    expect(vistos).toEqual(['a', 'b'])
    expect(erros).toHaveLength(1)
    expect(db.prepare("select count(*) as n from secret where name = 'y'").get()).toEqual({ n: 1 })
    db.close()
  })

  it('recusa fn assíncrona', () => {
    const db = openTestDb()
    const tx = createTx(db, () => {})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => tx((() => Promise.resolve(1)) as any)).toThrow(/síncrona/)
    db.close()
  })
})
