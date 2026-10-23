import { expect, it } from 'vitest'
import { kidCount, tree, visibleRows } from './tree'
import type { Task } from '../../shared/types'

const t = (id: string, parent: string | null = null): Task => ({
  id,
  title: id,
  status: '',
  bucket: { idx: 3, name: 'x' },
  parent,
  dir: 'current',
  readmePath: '',
  sessions: []
})

it('filho embaixo do pai', () =>
  expect(tree([t('A'), t('B', 'A')]).map((r) => [r.task.id, r.depth])).toEqual([
    ['A', 0],
    ['B', 1]
  ]))
it('pai inexistente → raiz', () => expect(tree([t('B', 'Z')]).map((r) => r.task.id)).toEqual(['B']))
it('ciclo de Pai (A→B→A) não some com as tasks', () =>
  expect(
    tree([t('A', 'B'), t('B', 'A')])
      .map((r) => r.task.id)
      .sort()
  ).toEqual(['A', 'B']))

const rows = tree([t('A'), t('B', 'A'), t('C', 'B'), t('D', 'A'), t('E')])
const ids = (rs: { task: Task }[]): string[] => rs.map((r) => r.task.id)

it('conta só os filhos diretos', () =>
  expect([...kidCount(rows)]).toEqual([
    ['A', 2],
    ['B', 1]
  ]))
it('pai fechado esconde a subárvore inteira', () =>
  expect(ids(visibleRows(rows, new Set()))).toEqual(['A', 'E']))
it('pai aberto mostra os filhos; neto segue fechado', () =>
  expect(ids(visibleRows(rows, new Set(['A'])))).toEqual(['A', 'B', 'D', 'E']))
it('pai e filho abertos mostram tudo', () =>
  expect(ids(visibleRows(rows, new Set(['A', 'B'])))).toEqual(['A', 'B', 'C', 'D', 'E']))
