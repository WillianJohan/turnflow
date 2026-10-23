import { describe, expect, it } from 'vitest'
import type { TaskRow } from '../../shared/contracts'
import { attentionFields, relativeAge } from './attentionFields'

const NOW = Date.parse('2026-10-22T12:00:00.000Z')

const row = (patch: Partial<TaskRow> = {}): TaskRow =>
  ({
    id: 'task-1',
    key: 'T-1',
    title: 'Ship the login',
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
    group: 'pendente',
    reason: { kind: 'voltou', since: '2026-10-22T11:00:00.000Z' },
    blocked_reason: null,
    session: { id: 'sess', tool: 'claude-code', state: 'waiting' },
    sum_where: null,
    sum_next: 'Ask for the folder',
    touched_at: '2026-10-22T10:00:00.000Z',
    faded: false,
    sort_key: '0',
    ...patch
  }) as TaskRow

describe('relativeAge', () => {
  it('usa a lista fechada now, minutos, horas, dias e semanas', () => {
    expect(relativeAge('2026-10-22T11:59:30.000Z', NOW)).toBe('now')
    expect(relativeAge('2026-10-22T11:05:00.000Z', NOW)).toBe('55m')
    expect(relativeAge('2026-10-22T09:00:00.000Z', NOW)).toBe('3h')
    expect(relativeAge('2026-10-20T12:00:00.000Z', NOW)).toBe('2d')
    expect(relativeAge('2026-10-01T12:00:00.000Z', NOW)).toBe('3w')
  })
})

describe('attentionFields', () => {
  it('compacta mostra estado, key e título', () => {
    expect(attentionFields(row(), 'compact', NOW)).toEqual({
      key: 'T-1',
      title: 'Ship the login',
      state: 'waiting',
      stage: null,
      motive: null,
      next: null,
      age: null
    })
  })

  it('normal acrescenta etapa e motivo, e Bloq. quando está bloqueada', () => {
    expect(attentionFields(row(), 'normal', NOW)).toMatchObject({
      stage: 'Impl',
      motive: 'Back',
      next: null
    })
    expect(
      attentionFields(row({ blocked_reason: 'waiting on review' }), 'normal', NOW).motive
    ).toBe('Bloq.')
  })

  it('abrangente acrescenta o próximo passo e a idade desde o motivo', () => {
    expect(attentionFields(row(), 'wide', NOW)).toMatchObject({
      next: 'Ask for the folder',
      age: '1h'
    })
    expect(attentionFields(row({ reason: null }), 'wide', NOW).age).toBe('2h')
  })
})
