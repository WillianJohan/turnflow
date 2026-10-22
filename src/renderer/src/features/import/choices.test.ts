import { describe, expect, it } from 'vitest'
import type { ImportPreview } from '../../../../shared/contracts'
import {
  applyInput,
  conflictsFor,
  emptyChoices,
  parseTarget,
  previewInput,
  reconcileConflicts,
  targetValue,
  withStatus,
  withTake,
  withWorkdir
} from './choices'

describe('applyInput', () => {
  it('transforma KEY|field em take_markdown', () => {
    const c = { ...emptyChoices(), take_markdown: new Set(['ABC-1|title']) }
    expect(applyInput('/brain', 'tok', c).take_markdown).toEqual([{ key: 'ABC-1', field: 'title' }])
  })

  it('sem escolhas manda listas e mapas vazios, sem type_id', () => {
    expect(applyInput('/brain', 'tok', emptyChoices())).toEqual({
      root: '/brain',
      token: 'tok',
      status_edits: {},
      take_markdown: [],
      workdirs: {}
    })
  })

  it('prévia e apply levam as mesmas escolhas', () => {
    let c = withStatus(emptyChoices(), 'weird status', { stage: 'Doing' })
    c = withTake(c, 'ABC-2', 'description', true)
    c = withWorkdir(c, 'ABC-3', '/work/abc-3')
    c = { ...c, type_id: 'type-1' }
    const { token, ...rest } = applyInput('/brain', 'tok', c)
    expect(token).toBe('tok')
    expect(rest).toEqual(previewInput('/brain', c))
    expect(rest).toEqual({
      root: '/brain',
      type_id: 'type-1',
      status_edits: { 'weird status': { stage: 'Doing' } },
      take_markdown: [{ key: 'ABC-2', field: 'description' }],
      workdirs: { 'ABC-3': '/work/abc-3' }
    })
  })
})

describe('edições', () => {
  it('não mudam o objeto anterior', () => {
    const a = emptyChoices()
    const b = withTake(a, 'ABC-1', 'title', true)
    const c = withWorkdir(b, 'ABC-1', '/w')
    expect(a.take_markdown.size).toBe(0)
    expect(b.workdirs).toEqual({})
    expect(withTake(c, 'ABC-1', 'title', false).take_markdown.size).toBe(0)
    expect(withWorkdir(c, 'ABC-1', null).workdirs).toEqual({})
    expect(c.take_markdown.has('ABC-1|title')).toBe(true)
  })
})

describe('valor do select de status', () => {
  it('ida e volta de etapa e papel', () => {
    for (const t of [{ stage: 'Code: review' }, { role: 'blocked' as const }])
      expect(parseTarget(targetValue(t))).toEqual(t)
    expect(targetValue(null)).toBe('')
    expect(parseTarget('')).toBeNull()
    expect(parseTarget('role:nope')).toBeNull()
  })
})

describe('reconcileConflicts', () => {
  const c = { key: 'ABC-1', field: 'title' as const, app: 'a', markdown: 'm' }
  const row = (o: Partial<ImportPreview['tasks'][number]>): ImportPreview['tasks'][number] => ({
    key: 'ABC-1',
    title: 't',
    dir: 'current',
    action: 'update',
    fields: ['title'],
    conflicts: [],
    new_checkpoints: 0,
    new_sessions: 0,
    new_links: 0,
    project: null,
    workdir_hint: null,
    reason: null,
    ...o
  })
  const p = (tasks: ImportPreview['tasks']): ImportPreview => ({ tasks }) as ImportPreview
  const known = { 'ABC-1|title': c }
  const take = new Set(['ABC-1|title'])

  it('resolvido com o markdown fica enquanto o campo é escrito', () => {
    expect(reconcileConflicts(known, p([row({})]), take)).toEqual(known)
  })

  it('sai quando a task some, fica inválida, não escreve o campo ou não foi tomado', () => {
    expect(reconcileConflicts(known, p([]), take)).toEqual({})
    expect(reconcileConflicts(known, p([row({ action: 'invalid' })]), take)).toEqual({})
    expect(reconcileConflicts(known, p([row({ fields: [] })]), take)).toEqual({})
    expect(reconcileConflicts(known, p([row({})]), new Set())).toEqual({})
  })

  it('conflito da prévia entra com os valores dela', () => {
    const fresh = { ...c, markdown: 'm2' }
    expect(reconcileConflicts(known, p([row({ conflicts: [fresh] })]), new Set())).toEqual({
      'ABC-1|title': fresh
    })
  })
})

it('conflictsFor: ordem fixa de campo, com o resolvido escondido no lugar dele', () => {
  const desc = { key: 'ABC-1', field: 'description' as const, app: 'a', markdown: 'm' }
  const title = { key: 'ABC-1', field: 'title' as const, app: 'a', markdown: 'm' }
  const other = { key: 'ABC-2', field: 'title' as const, app: 'a', markdown: 'm' }
  const t = { key: 'ABC-1', conflicts: [desc] } as ImportPreview['tasks'][number]
  expect(
    conflictsFor(t, { 'ABC-1|title': title, 'ABC-2|title': other }).map((c) => c.field)
  ).toEqual(['title', 'description'])
})
