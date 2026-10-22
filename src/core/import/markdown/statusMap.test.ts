import { DomainError } from '../../domain/errors'
import { describe, expect, it } from 'vitest'
import {
  normalizeEntries,
  resolveRole,
  suggestTarget,
  resolveStatus,
  statusKey,
  statusReason,
  type FlowStageLite,
  type Resolved,
  type StatusMapFile
} from './statusMap'

const st = (
  id: string,
  name: string,
  position: number,
  o: Partial<FlowStageLite> = {}
): FlowStageLite => ({
  id,
  name,
  short_name: name.slice(0, 3),
  position,
  waits_other: false,
  is_final: false,
  ...o
})

const feature: FlowStageLite[] = [
  st('s1', 'Refinement', 0),
  st('s2', 'Implementation', 1),
  st('s3', 'Review', 2, { waits_other: true }),
  st('s4', 'Done', 3, { is_final: true })
]
const personal: FlowStageLite[] = [
  st('p1', 'To do', 0),
  st('p2', 'Doing', 1),
  st('p3', 'Done', 2, { is_final: true })
]
const empty: StatusMapFile = { version: 1, entries: {} }
const res = (
  status: string | null,
  dir: 'current' | 'backlog' | 'done' = 'current',
  map = empty,
  stages = feature,
  blocked: string | null = null
): Resolved => resolveStatus({ status, dir, blocked }, map, stages)

describe('statusKey / statusReason', () => {
  it('chave e motivo', () => {
    expect(statusKey('Bloqueada: aguardando X')).toBe('bloqueada')
    expect(statusReason('Bloqueada: aguardando X')).toBe('aguardando X')
    expect(statusKey('  Em Andamento ')).toBe('em andamento')
    expect(statusKey('Em Andamento')).toBe('em andamento')
    expect(statusReason('Em andamento')).toBeNull()
    expect(statusReason('Bloqueada:   ')).toBeNull()
    expect(statusKey('Revisão')).toBe('revisao')
  })
})

describe('resolveStatus', () => {
  it.each([
    ['in progress', 'Implementation'],
    ['em teste', 'Review'],
    ['entregue', 'Done'],
    ['refinamento', 'Refinement'],
    ['Backlog', 'Refinement'],
    ['Revisão', 'Review'],
    ['hecho', 'Done'],
    ['en progreso', 'Implementation']
  ])('semente: %s -> %s', (status, stage) => {
    const r = res(status)
    expect(feature.find((s) => s.id === r.stage_id)?.name).toBe(stage)
    expect(r.source).toBe('seed')
    expect(r.mapped).toBe(true)
  })

  it('bloqueada: x vai para a primeira etapa com motivo', () => {
    const r = res('bloqueada: x')
    expect(r).toMatchObject({ stage_id: 's1', blocked_reason: 'x', source: 'seed', mapped: true })
  })

  it('nome de etapa vence a semente', () => {
    const r = res('review')
    expect(r).toMatchObject({ stage_id: 's3', source: 'stage_name', mapped: true })
    expect(
      res('Impl.', 'current', empty, [st('a', 'Impl.', 0), st('b', 'Fim', 1, { is_final: true })])
    ).toMatchObject({
      stage_id: 'a',
      source: 'stage_name'
    })
  })

  it('casa o short_name', () => {
    const stages = [st('a', 'Nada', 0, { short_name: 'qa' }), st('b', 'Fim', 1, { is_final: true })]
    expect(res('QA', 'current', empty, stages)).toMatchObject({
      stage_id: 'a',
      source: 'stage_name'
    })
  })

  it('salvo vence tudo', () => {
    const map: StatusMapFile = { version: 1, entries: { 'em teste': { stage: 'Implementation' } } }
    expect(res('em teste', 'current', map)).toMatchObject({
      stage_id: 's2',
      source: 'saved',
      mapped: true,
      target: { stage: 'Implementation' }
    })
  })

  it('salvo por papel', () => {
    const map: StatusMapFile = { version: 1, entries: { weird: { role: 'review' } } }
    expect(res('Weird', 'current', map)).toMatchObject({ stage_id: 's3', source: 'saved' })
  })

  it('sem mapeamento cai na primeira etapa', () => {
    expect(res('status weird')).toMatchObject({
      stage_id: 's1',
      mapped: false,
      source: 'none',
      target: null
    })
    expect(res('status weird', 'backlog')).toMatchObject({
      stage_id: 's1',
      mapped: false,
      source: 'none'
    })
    expect(res(null)).toMatchObject({ stage_id: 's1', mapped: false, source: 'none' })
  })

  it('dir done vai para a final, mesmo com status estranho ou bloqueio', () => {
    expect(res('status weird', 'done')).toMatchObject({
      stage_id: 's4',
      mapped: true,
      blocked_reason: null
    })
    expect(res(null, 'done', empty, feature, 'x')).toMatchObject({
      stage_id: 's4',
      blocked_reason: null
    })
  })

  it('stage salvo sem par: mapped false, source saved, target preservado', () => {
    const map: StatusMapFile = { version: 1, entries: { 'em teste': { stage: 'Inexistente' } } }
    expect(res('em teste', 'current', map)).toMatchObject({
      stage_id: 's1',
      mapped: false,
      source: 'saved',
      target: { stage: 'Inexistente' }
    })
  })

  it('bloqueado sem dois pontos guarda o status como motivo', () => {
    expect(res('Bloqueada')).toMatchObject({ stage_id: 's1', blocked_reason: 'Bloqueada' })
    expect(res('  Blocked ')).toMatchObject({ blocked_reason: 'Blocked' })
    const map: StatusMapFile = { version: 1, entries: { aguardando: { role: 'blocked' } } }
    expect(res('Aguardando', 'current', map)).toMatchObject({ blocked_reason: 'Aguardando' })
    expect(res('bloqueada: x')).toMatchObject({ blocked_reason: 'x' })
  })

  it('chave vazia nunca casa etapa nem semente', () => {
    const stages = [st('a', 'Nada', 0, { short_name: '' }), st('b', 'Fim', 1, { is_final: true })]
    for (const s of ['', '   ', ':x']) {
      expect(res(s, 'current', empty, stages)).toMatchObject({
        stage_id: 'a',
        mapped: false,
        source: 'none'
      })
    }
  })

  it('suggestTarget por nome devolve o id da etapa casada', () => {
    const dup = [
      st('a', 'Same', 0),
      st('b', 'Other', 1, { short_name: 'same' }),
      st('c', 'Fim', 2, { is_final: true })
    ]
    expect(suggestTarget('same', empty, dup)).toMatchObject({ source: 'stage_name', stage_id: 'a' })
  })

  it('chaves salvas sao normalizadas por statusKey na leitura do mapa em memoria', () => {
    expect(normalizeEntries({ ' Em Teste: x ': { role: 'review' } }).entries).toEqual({
      'em teste': { role: 'review' }
    })
  })

  it('resolveRole sem etapas e erro de dominio', () => {
    expect(() => resolveRole('first', [])).toThrow(DomainError)
    expect(() => resolveStatus({ status: 'x', dir: 'current', blocked: null }, empty, [])).toThrow(
      DomainError
    )
  })

  it('linha Blocked poe o motivo em etapa nao final', () => {
    expect(res('in progress', 'current', empty, feature, 'esperando')).toMatchObject({
      stage_id: 's2',
      blocked_reason: 'esperando'
    })
    expect(res('done', 'current', empty, feature, 'esperando')).toMatchObject({
      stage_id: 's4',
      blocked_reason: null
    })
    expect(res('status weird', 'current', empty, feature, 'esperando')).toMatchObject({
      stage_id: 's1',
      blocked_reason: 'esperando',
      mapped: false
    })
  })

  it('papeis num fluxo sem review', () => {
    expect(resolveRole('review', personal)).toBe('p2')
    expect(resolveRole('working', personal)).toBe('p2')
    expect(resolveRole('first', personal)).toBe('p1')
    expect(resolveRole('final', personal)).toBe('p3')
    expect(resolveRole('blocked', personal)).toBe('p1')
  })

  it('working cai em first quando so ha uma etapa nao final', () => {
    const one = [st('a', 'Only', 0), st('b', 'End', 1, { is_final: true })]
    expect(resolveRole('working', one)).toBe('a')
    expect(resolveRole('review', one)).toBe('a')
  })

  it('papeis no fluxo Feature', () => {
    expect(resolveRole('working', feature)).toBe('s2')
    expect(resolveRole('review', feature)).toBe('s3')
    expect(resolveRole('final', feature)).toBe('s4')
  })
})
