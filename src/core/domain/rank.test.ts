import Database from 'better-sqlite3-multiple-ciphers'
import { describe, expect, it } from 'vitest'
import { rankAfter } from './rank'

describe('rankAfter', () => {
  it('formato do fractional-indexing: a0, a1, aA, b00', () => {
    expect(rankAfter(null)).toBe('a0')
    expect(rankAfter('a0')).toBe('a1')
    expect(rankAfter('a9')).toBe('aA')
    expect(rankAfter('aZ')).toBe('aa')
    expect(rankAfter('az')).toBe('b00')
    expect(rankAfter('b0z')).toBe('b10')
    expect(rankAfter('bzz')).toBe('c000')
  })

  it('ignora a parte fracionária (só incrementa o inteiro)', () => {
    expect(rankAfter('a0V')).toBe('a1')
  })

  it('chave negativa (cabeça maiúscula) também cresce', () => {
    expect(rankAfter('Zz')).toBe('a0')
    expect(rankAfter('Z0')).toBe('Z1')
  })

  it('chave fora do formato lança', () => {
    expect(() => rankAfter('')).toThrow()
    expect(() => rankAfter('a')).toThrow()
    expect(() => rankAfter('1a')).toThrow()
    expect(() => rankAfter('a!')).toThrow()
  })

  it('5000 encadeadas crescem na comparação JS e no order by do SQLite', () => {
    const ranks: string[] = []
    let prev: string | null = null
    for (let i = 0; i < 5000; i++) ranks.push((prev = rankAfter(prev)))
    for (let i = 1; i < ranks.length; i++) expect(ranks[i - 1] < ranks[i]).toBe(true)

    const db = new Database(':memory:')
    db.exec('create table r(rank text)')
    const ins = db.prepare('insert into r(rank) values (?)')
    // insere embaralhado: a ordem tem que vir do order by, não da inserção
    for (const r of [...ranks].reverse()) ins.run(r)
    const sorted = (db.prepare('select rank from r order by rank').all() as { rank: string }[]).map(
      (x) => x.rank
    )
    db.close()
    expect(sorted).toEqual(ranks)
  })
})
