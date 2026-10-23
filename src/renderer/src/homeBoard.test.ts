import { describe, expect, it } from 'vitest'
import type { TaskRow } from '../../shared/contracts'
import { homeColumns, homeLine, stalledLabel } from './homeBoard'

const row = (patch: Partial<TaskRow>): TaskRow =>
  ({
    id: patch.id ?? 't',
    key: patch.key ?? 'T-1',
    title: patch.title ?? 'Ship',
    type_id: 'feature',
    project_id: null,
    stage: {
      id: 's',
      name: 'Implementation',
      short_name: 'Impl',
      position: 1,
      count: 4,
      is_final: false
    },
    group: patch.group ?? 'pendente',
    reason:
      patch.reason === undefined
        ? { kind: 'voltou', since: '2026-10-22T11:00:00.000Z' }
        : patch.reason,
    blocked_reason: patch.blocked_reason ?? null,
    session: null,
    sum_where: null,
    sum_next: null,
    touched_at: '2026-10-22T11:00:00.000Z',
    faded: false,
    sort_key: '0',
    ...patch
  }) as TaskRow

describe('homeColumns', () => {
  it('três colunas e a contagem de paradas só no Pendente', () => {
    const cols = homeColumns([
      row({ id: 'a', group: 'sua_vez' }),
      row({ id: 'b', group: 'pendente' }),
      row({ id: 'c', group: 'encaminhado', blocked_reason: 'review' }),
      row({ id: 'd', group: 'fila_projeto' }),
      row({ id: 'e', group: 'fila_projeto' }),
      row({ id: 'f', group: 'concluida' })
    ])
    expect(cols.map((c) => c.id)).toEqual(['sua_vez', 'pendente', 'encaminhado'])
    expect(cols[0].rows.map((r) => r.id)).toEqual(['a'])
    expect(cols[1].rows.map((r) => r.id)).toEqual(['b'])
    expect(cols[1].stalled).toBe(2)
    expect(cols[2].rows.map((r) => r.id)).toEqual(['c'])
    expect(cols[2].stalled).toBe(0)
    expect(stalledLabel(2)).toBe('2 stalled in projects')
    expect(stalledLabel(0)).toBeNull()
  })
})

describe('homeLine', () => {
  it('painel estreito esconde key e motivo e mantém título e tag', () => {
    const blocked = row({
      title: 'Fix',
      key: 'T-9',
      blocked_reason: 'review',
      group: 'encaminhado'
    })
    expect(homeLine(blocked, false)).toEqual({
      title: 'Fix',
      key: 'T-9',
      motive: null,
      tag: 'Bloq.'
    })
    expect(homeLine(blocked, true)).toEqual({ title: 'Fix', key: null, motive: null, tag: 'Bloq.' })
    expect(homeLine(row({ title: 'Ship', key: 'T-1' }), true)).toEqual({
      title: 'Ship',
      key: null,
      motive: null,
      tag: null
    })
    expect(homeLine(row({ title: 'Ship', key: 'T-1' }), false).motive).toBe('Back')
  })
})
