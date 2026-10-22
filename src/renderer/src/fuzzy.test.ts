import { expect, it } from 'vitest'
import { fuzzyScore } from './fuzzy'

it('casa número', () => expect(fuzzyScore('4882', 'T-4882 Migração')).not.toBeNull())
it('ignora acento e caixa', () => expect(fuzzyScore('migracao', 'T-1 Migração')).not.toBeNull())
it('sem casar → null', () => expect(fuzzyScore('xyz', 'T-4882 Migração')).toBeNull())
it('contíguo/início de palavra pontua mais', () =>
  expect(fuzzyScore('jorn', 'T-5016 jornada')!).toBeGreaterThan(
    fuzzyScore('jorn', 'T-1 ajuste de rota interna')!
  ))
it('query vazia casa tudo', () => expect(fuzzyScore('', 'qualquer')).toBe(0))
