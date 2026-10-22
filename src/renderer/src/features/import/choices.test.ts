import { describe, expect, it } from 'vitest'
import {
  applyInput,
  emptyChoices,
  parseTarget,
  previewInput,
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
