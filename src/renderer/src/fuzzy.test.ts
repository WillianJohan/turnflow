import { expect, it } from 'vitest'
import { fuzzyScore } from './fuzzy'

it('casa número', () => expect(fuzzyScore('4882', 'WF-4882 Estadão')).not.toBeNull())
it('ignora acento e caixa', () => expect(fuzzyScore('estadao', 'WF-1 Estadão')).not.toBeNull())
it('sem casar → null', () => expect(fuzzyScore('xyz', 'WF-4882 Estadão')).toBeNull())
it('contíguo/início de palavra pontua mais', () =>
  expect(fuzzyScore('jorn', 'WF-5016 jornada')!).toBeGreaterThan(
    fuzzyScore('jorn', 'WF-1 ajuste de rota interna')!
  ))
it('query vazia casa tudo', () => expect(fuzzyScore('', 'qualquer')).toBe(0))
