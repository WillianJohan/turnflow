import { describe, expect, it } from 'vitest'
import { Flow, StagePairing, TaskType } from '../../shared/contracts'
import type { DomainChanged } from '../../shared/ipc/events'
import type { Db } from '../db/open'
import { dumpTables, openTestDb, seedIds } from '../testing/db'
import { readActivity } from './activity'
import { createDomain, type Actor, type DomainDeps } from './context'
import { DomainError } from './errors'
import {
  deleteStage,
  listFlows,
  listTypes,
  previewRemap,
  remapTarget,
  saveStage,
  setTaskFlow
} from './flow'
import { getTask, taskRow, type TaskRecord } from './rows'
import { createTask, deleteTask, setStage } from './task'

const T0 = Date.parse('2026-10-22T12:00:00.000Z')
const MIN = 60_000
const USER: Actor = { kind: 'user' }

type Harness = {
  db: Db
  d: DomainDeps
  events: DomainChanged[]
  ids: ReturnType<typeof seedIds>
  tick: (ms: number) => void
  nowIso: () => string
}

function setup(): Harness {
  const db = openTestDb()
  const events: DomainChanged[] = []
  let t = T0
  const d = createDomain({ db, afterCommit: (c) => events.push(c), now: () => new Date(t) })
  return {
    db,
    d,
    events,
    ids: seedIds(db),
    tick: (ms) => (t += ms),
    nowIso: () => new Date(t).toISOString()
  }
}

const errOf = (fn: () => unknown): DomainError => {
  try {
    fn()
  } catch (e) {
    if (e instanceof DomainError) return e
    throw e
  }
  throw new Error('não lançou')
}

const raw = (db: Db, id: string): TaskRecord =>
  db.prepare('select * from task where id = ?').get(id) as TaskRecord

/** Task Feature numa etapa da semente (índice 0..3). */
function featureAt(h: Harness, stage: number): string {
  const id = createTask(h.d, USER, { title: 't', type_id: h.ids.types.Feature }).row!.id
  if (stage > 0) setStage(h.d, USER, { id, stage_id: h.ids.stages.Feature[stage] })
  return id
}

const flowOf = (h: Harness, flowId: string): Flow => listFlows(h.d).find((f) => f.id === flowId)!

/** Coluna `position` crua das etapas vivas, em ordem. */
const livePositions = (db: Db, flowId: string): number[] =>
  (
    db
      .prepare(
        'select position from flow_stage where flow_id = ? and deleted_at is null order by position'
      )
      .all(flowId) as { position: number }[]
  ).map((r) => r.position)

const expectContiguous = (db: Db, flowId: string): void => {
  const p = livePositions(db, flowId)
  expect(p).toEqual(p.map((_, i) => i + 1))
}

const stageInput = (
  h: Harness,
  id: string
): {
  flow_id: string
  id: string
  name: string
  short_name: string
  waits_other: boolean
  is_final: boolean
} => {
  const s = h.db
    .prepare('select flow_id, name, short_name, waits_other, is_final from flow_stage where id = ?')
    .get(id) as {
    flow_id: string
    name: string
    short_name: string
    waits_other: number
    is_final: number
  }
  return { ...s, id, waits_other: s.waits_other === 1, is_final: s.is_final === 1 }
}

const DUMP = ['task', 'flow_stage', 'activity', 'sync_outbox']

describe('listFlows e listTypes', () => {
  it('semente com etapas em ordem, ordinal 1-based e contagem de tasks vivas', () => {
    const h = setup()
    featureAt(h, 1)
    const gone = featureAt(h, 1)
    deleteTask(h.d, USER, { id: gone })
    const flows = listFlows(h.d)
    for (const f of flows) Flow.parse(f)
    expect(flows.map((f) => [f.name, f.is_default])).toEqual([
      ['Feature', true],
      ['Bugfix', false],
      ['Pessoal', false]
    ])
    const feature = flows[0]
    expect(feature.stages.map((s) => [s.name, s.position, s.live_task_count])).toEqual([
      ['Refinamento', 1, 0],
      ['Implementação', 2, 1],
      ['Review', 3, 0],
      ['Entregue', 4, 0]
    ])
    expect(feature.stages[2]).toMatchObject({ waits_other: true, is_final: false })
    expect(feature.stages[3]).toMatchObject({ is_final: true, remote_star_status: null })
    const types = listTypes(h.d)
    for (const t of types) TaskType.parse(t)
    expect(types.map((t) => [t.name, t.flow_id, t.syncs])).toEqual([
      ['Feature', h.ids.flows.Feature, true],
      ['Bugfix', h.ids.flows.Bugfix, true],
      ['Pessoal', h.ids.flows.Pessoal, false]
    ])
  })
})

describe('deleteStage', () => {
  it('etapa com task exige remapear', () => {
    const h = setup()
    const [ref, impl] = h.ids.stages.Feature
    const id = featureAt(h, 1)
    const before = dumpTables(h.db, DUMP)
    h.events.length = 0

    const e = errOf(() => deleteStage(h.d, USER, { id: impl }))
    expect(e.code).toBe('CONFLICT')
    expect(e.details).toMatchObject({
      reason: 'stage_has_tasks',
      task_count: 1,
      deleted_count: 0,
      suggested: ref
    })
    expect(dumpTables(h.db, DUMP)).toEqual(before)
    expect(h.events).toEqual([])

    h.tick(MIN)
    const flow = deleteStage(h.d, USER, { id: impl, to_stage_id: ref })
    expect(raw(h.db, id).stage_id).toBe(ref)
    const st = h.db.prepare('select deleted_at from flow_stage where id = ?').get(impl) as {
      deleted_at: string | null
    }
    expect(st.deleted_at).toBe(h.nowIso())
    expect(flow.stages.map((s) => [s.name, s.position])).toEqual([
      ['Refinamento', 1],
      ['Review', 2],
      ['Entregue', 3]
    ])
    expect(flowOf(h, h.ids.flows.Feature)).toEqual(flow)
    expectContiguous(h.db, h.ids.flows.Feature)
    expect(getTask(h.d, id).stage).toMatchObject({ name: 'Refinamento', position: 1, count: 3 })

    const acts = h.db.prepare("select id from activity where op = 'stage_remap'").all() as {
      id: string
    }[]
    expect(acts).toHaveLength(1)
    const a = readActivity(h.db, acts[0].id)!
    expect(a).toMatchObject({ task_id: id, inverse: null, actor: 'user' })
    expect(a.data).toMatchObject({ from: 'Implementação', to: 'Refinamento' })
    expect(a.data.fields).toContain('stage_id')
    expect(h.events).toContainEqual({ entity: 'flow', ids: [h.ids.flows.Feature], op: 'upsert' })
    expect(h.events).toContainEqual(
      expect.objectContaining({ entity: 'task', op: 'upsert', ids: expect.arrayContaining([id]) })
    )
  })

  it('sugere a seguinte quando não há etapa viva anterior', () => {
    const h = setup()
    const [ref, impl] = h.ids.stages.Feature
    featureAt(h, 0)
    const e = errOf(() => deleteStage(h.d, USER, { id: ref }))
    expect(e.details).toMatchObject({ reason: 'stage_has_tasks', suggested: impl })
  })

  it('task apagada também é remapeada', () => {
    const h = setup()
    const [, impl, , entregue] = h.ids.stages.Feature
    const id = featureAt(h, 1)
    deleteTask(h.d, USER, { id })

    const e = errOf(() => deleteStage(h.d, USER, { id: impl }))
    expect(e.code).toBe('CONFLICT')
    expect(e.details).toMatchObject({ reason: 'stage_has_tasks', task_count: 1, deleted_count: 1 })

    h.tick(MIN)
    deleteStage(h.d, USER, { id: impl, to_stage_id: entregue })
    const r = raw(h.db, id)
    expect(r.stage_id).toBe(entregue)
    // foi para uma etapa final: done_at recalculado
    expect(r.done_at).toBe(h.nowIso())
    expect(r.deleted_at).not.toBeNull()
    // Atividade só por task viva
    expect(
      (
        h.db.prepare("select count(*) as n from activity where op = 'stage_remap'").get() as {
          n: number
        }
      ).n
    ).toBe(0)
    // desapagar (o Desfazer do Task 8 só zera deleted_at) cai numa etapa viva
    h.db.prepare('update task set deleted_at = null where id = ?').run(id)
    expect(taskRow(h.d, id)!.stage).toMatchObject({ name: 'Entregue', is_final: true })
  })

  it('remap não toca touched_at nem a vez', () => {
    const h = setup()
    const [ref, impl] = h.ids.stages.Feature
    const a = featureAt(h, 1)
    h.tick(MIN)
    const b = featureAt(h, 1)
    h.db
      .prepare("update task set turn_reason = 'atribuida', turn_at = ? where id = ?")
      .run(h.nowIso(), b)
    const before = [raw(h.db, a), raw(h.db, b)]
    h.tick(10 * MIN)
    deleteStage(h.d, USER, { id: impl, to_stage_id: ref })
    for (const [i, id] of [a, b].entries()) {
      const r = raw(h.db, id)
      expect(r.stage_id).toBe(ref)
      expect(r.touched_at).toBe(before[i].touched_at)
      expect(r.turn_reason).toBe(before[i].turn_reason)
      expect(r.done_at).toBeNull()
    }
  })

  it('destino de outro fluxo, apagado ou a própria etapa: VALIDATION sem escrever', () => {
    const h = setup()
    const [, impl, review] = h.ids.stages.Feature
    featureAt(h, 1)
    deleteStage(h.d, USER, { id: review })
    const before = dumpTables(h.db, DUMP)
    for (const to of [h.ids.stages.Bugfix[0], review, impl]) {
      const e = errOf(() => deleteStage(h.d, USER, { id: impl, to_stage_id: to }))
      expect(e.code).toBe('VALIDATION')
      expect(e.details?.reason).toBe('stage_not_in_flow')
    }
    expect(dumpTables(h.db, DUMP)).toEqual(before)
  })

  it('etapa inexistente ou já apagada: NOT_FOUND', () => {
    const h = setup()
    const review = h.ids.stages.Feature[2]
    deleteStage(h.d, USER, { id: review })
    expect(errOf(() => deleteStage(h.d, USER, { id: review })).code).toBe('NOT_FOUND')
    expect(errOf(() => deleteStage(h.d, USER, { id: 'nada' })).code).toBe('NOT_FOUND')
  })
})

describe('integridade do fluxo', () => {
  it('última final, mudar final com task e última etapa', () => {
    const h = setup()
    const [, impl, , entregue] = h.ids.stages.Feature
    featureAt(h, 1)
    const before = dumpTables(h.db, DUMP)

    const del = errOf(() => deleteStage(h.d, USER, { id: entregue }))
    expect([del.code, del.details?.reason]).toEqual(['CONFLICT', 'last_final'])

    const unmark = errOf(() =>
      saveStage(h.d, USER, { ...stageInput(h, entregue), is_final: false })
    )
    expect([unmark.code, unmark.details?.reason]).toEqual(['CONFLICT', 'last_final'])

    const mark = errOf(() => saveStage(h.d, USER, { ...stageInput(h, impl), is_final: true }))
    expect([mark.code, mark.details?.reason]).toEqual(['CONFLICT', 'final_change_with_tasks'])
    expect(dumpTables(h.db, DUMP)).toEqual(before)

    // fluxo de 1 etapa: ela é também a única final, e vale last_stage (checado antes)
    h.db.prepare("insert into flow(id, name, is_default) values ('solo', 'Solo', 0)").run()
    h.db
      .prepare(
        `insert into flow_stage(id, flow_id, position, name, short_name, is_final)
         values ('solo-1', 'solo', 1, 'Só', 'Só', 1)`
      )
      .run()
    const last = errOf(() => deleteStage(h.d, USER, { id: 'solo-1' }))
    expect([last.code, last.details?.reason]).toEqual(['CONFLICT', 'last_stage'])
  })

  it('última final vem antes de stage_has_tasks', () => {
    const h = setup()
    const entregue = h.ids.stages.Feature[3]
    featureAt(h, 3)
    const e = errOf(() => deleteStage(h.d, USER, { id: entregue }))
    expect(e.details?.reason).toBe('last_final')
  })

  it('mudar final só com task apagada é permitido e recalcula o done_at dela', () => {
    const h = setup()
    const impl = h.ids.stages.Feature[1]
    const id = featureAt(h, 1)
    deleteTask(h.d, USER, { id })
    h.tick(MIN)
    saveStage(h.d, USER, { ...stageInput(h, impl), is_final: true })
    expect(raw(h.db, id).done_at).toBe(h.nowIso())
    saveStage(h.d, USER, { ...stageInput(h, impl), is_final: false })
    expect(raw(h.db, id).done_at).toBeNull()
  })

  it('uma segunda final pode ser desmarcada e apagada', () => {
    const h = setup()
    const [, , review, entregue] = h.ids.stages.Feature
    saveStage(h.d, USER, { ...stageInput(h, review), is_final: true })
    saveStage(h.d, USER, { ...stageInput(h, entregue), is_final: false })
    const f = deleteStage(h.d, USER, { id: entregue })
    expect(f.stages.filter((s) => s.is_final).map((s) => s.name)).toEqual(['Review'])
  })
})

describe('saveStage', () => {
  it('cria na posição pedida e renumera', () => {
    const h = setup()
    const f = saveStage(h.d, USER, {
      flow_id: h.ids.flows.Feature,
      name: 'Teste',
      short_name: 'Tst',
      waits_other: false,
      is_final: false,
      position: 2
    })
    expect(f.stages.map((s) => [s.name, s.short_name, s.position])).toEqual([
      ['Refinamento', 'Ref.', 1],
      ['Teste', 'Tst', 2],
      ['Implementação', 'Impl.', 3],
      ['Review', 'Review', 4],
      ['Entregue', 'Entr.', 5]
    ])
    expectContiguous(h.db, h.ids.flows.Feature)
    expect(h.events).toContainEqual({ entity: 'flow', ids: [h.ids.flows.Feature], op: 'upsert' })
  })

  it('sem position cria no fim', () => {
    const h = setup()
    const f = saveStage(h.d, USER, {
      flow_id: h.ids.flows.Pessoal,
      name: 'Arquivado',
      short_name: 'Arq.',
      waits_other: false,
      is_final: true
    })
    expect(f.stages.map((s) => s.name)).toEqual(['A fazer', 'Fazendo', 'Feito', 'Arquivado'])
    expect(f.stages[3]).toMatchObject({ position: 4, is_final: true })
  })

  it('renomear muda o short_name na linha das tasks e emite task/upsert delas', () => {
    const h = setup()
    const review = h.ids.stages.Feature[2]
    const id = featureAt(h, 2)
    const other = createTask(h.d, USER, { title: 'b', type_id: h.ids.types.Bugfix }).row!.id
    h.events.length = 0
    saveStage(h.d, USER, { ...stageInput(h, review), name: 'Revisão', short_name: 'Rev.' })
    expect(taskRow(h.d, id)!.stage).toMatchObject({ name: 'Revisão', short_name: 'Rev.' })
    const taskIds = h.events.filter((e) => e.entity === 'task').flatMap((e) => e.ids)
    expect(taskIds).toContain(id)
    expect(taskIds).not.toContain(other)
    expect(h.events).toContainEqual({ entity: 'flow', ids: [h.ids.flows.Feature], op: 'upsert' })
  })

  it('waits_other desligado tira a task de encaminhado', () => {
    const h = setup()
    const review = h.ids.stages.Feature[2]
    const id = featureAt(h, 2)
    expect(taskRow(h.d, id)!.group).toBe('encaminhado')
    saveStage(h.d, USER, { ...stageInput(h, review), waits_other: false })
    expect(taskRow(h.d, id)!.group).toBe('pendente')
  })

  it('reordenar mantém posições únicas e contíguas, e muda o ordinal da task', () => {
    const h = setup()
    const [, , review, entregue] = h.ids.stages.Feature
    const id = featureAt(h, 2)
    let f = saveStage(h.d, USER, { ...stageInput(h, review), position: 1 })
    expect(f.stages.map((s) => s.name)).toEqual([
      'Review',
      'Refinamento',
      'Implementação',
      'Entregue'
    ])
    expectContiguous(h.db, h.ids.flows.Feature)
    expect(taskRow(h.d, id)!.stage.position).toBe(1)

    // posição além do fim vai para o fim
    f = saveStage(h.d, USER, { ...stageInput(h, review), position: 99 })
    expect(f.stages.map((s) => s.name)).toEqual([
      'Refinamento',
      'Implementação',
      'Entregue',
      'Review'
    ])
    expectContiguous(h.db, h.ids.flows.Feature)

    deleteStage(h.d, USER, { id: h.ids.stages.Feature[1] })
    expectContiguous(h.db, h.ids.flows.Feature)
    f = saveStage(h.d, USER, { ...stageInput(h, entregue), position: 1 })
    expect(f.stages.map((s) => [s.name, s.position])).toEqual([
      ['Entregue', 1],
      ['Refinamento', 2],
      ['Review', 3]
    ])
    expectContiguous(h.db, h.ids.flows.Feature)
  })

  it('mesmos valores é no-op: nada escrito e nada emitido', () => {
    const h = setup()
    const review = h.ids.stages.Feature[2]
    featureAt(h, 2)
    const before = dumpTables(h.db, DUMP)
    h.events.length = 0
    saveStage(h.d, USER, { ...stageInput(h, review), position: 3 })
    expect(dumpTables(h.db, DUMP)).toEqual(before)
    expect(h.events).toEqual([])
  })

  it('nome vazio, etapa de outro fluxo e fluxo inexistente', () => {
    const h = setup()
    const review = h.ids.stages.Feature[2]
    const blank = errOf(() => saveStage(h.d, USER, { ...stageInput(h, review), name: '   ' }))
    expect([blank.code, blank.details?.reason]).toEqual(['VALIDATION', 'name_required'])
    const long = errOf(() =>
      saveStage(h.d, USER, { ...stageInput(h, review), short_name: 'x'.repeat(101) })
    )
    expect([long.code, long.details?.reason]).toEqual(['VALIDATION', 'too_long'])
    expect(
      errOf(() => saveStage(h.d, USER, { ...stageInput(h, review), flow_id: h.ids.flows.Bugfix }))
        .code
    ).toBe('NOT_FOUND')
    expect(
      errOf(() =>
        saveStage(h.d, USER, {
          flow_id: 'nada',
          name: 'a',
          short_name: 'a',
          waits_other: false,
          is_final: false
        })
      ).code
    ).toBe('NOT_FOUND')
  })
})

describe('previewRemap', () => {
  it('prévia lista cada etapa com par', () => {
    const h = setup()
    const [, , bReview, bEntregue] = h.ids.stages.Bugfix
    const p = previewRemap(h.d, h.ids.flows.Feature, h.ids.flows.Bugfix)
    for (const x of p) StagePairing.parse(x)
    expect(p.map((x) => [x.from.name, x.from.position, x.to_stage_id])).toEqual([
      ['Refinamento', 1, null],
      ['Implementação', 2, null],
      ['Review', 3, bReview],
      ['Entregue', 4, bEntregue]
    ])
  })

  it('casa por short_name e final↔final, ignorando acento e caixa', () => {
    const h = setup()
    const [aFazer, , feito] = h.ids.stages.Pessoal
    const [ref, impl] = h.ids.stages.Feature
    // Refinamento ganha short_name 'a FAZER' (casa por short_name); Implementação vira 'fazendo'
    saveStage(h.d, USER, { ...stageInput(h, ref), short_name: 'a FAZER' })
    saveStage(h.d, USER, { ...stageInput(h, impl), name: 'FAZÊNDO' })
    const p = previewRemap(h.d, h.ids.flows.Feature, h.ids.flows.Pessoal)
    expect(p.map((x) => x.to_stage_id)).toEqual([
      aFazer,
      h.ids.stages.Pessoal[1],
      null,
      feito // Entregue não tem par por nome: final↔final
    ])
  })

  it('fluxo inexistente: NOT_FOUND', () => {
    const h = setup()
    expect(errOf(() => previewRemap(h.d, h.ids.flows.Feature, 'nada')).code).toBe('NOT_FOUND')
  })
})

describe('setTaskFlow', () => {
  it('etapa sem par bloqueia até escolher', () => {
    const h = setup()
    const impl = h.ids.stages.Feature[1]
    const corrigir = h.ids.stages.Bugfix[1]
    const id = featureAt(h, 1)
    const before = dumpTables(h.db, DUMP)
    h.events.length = 0

    const e = errOf(() => setTaskFlow(h.d, USER, { id, flow_id: h.ids.flows.Bugfix }))
    expect([e.code, e.details?.reason]).toEqual(['CONFLICT', 'remap_required'])
    expect(e.details?.missing).toEqual([impl])
    expect(e.details?.preview).toHaveLength(4)
    expect(e.details?.preview).toEqual(previewRemap(h.d, h.ids.flows.Feature, h.ids.flows.Bugfix))
    expect(dumpTables(h.db, DUMP)).toEqual(before)
    expect(h.events).toEqual([])

    h.tick(MIN)
    const r = setTaskFlow(h.d, USER, {
      id,
      flow_id: h.ids.flows.Bugfix,
      mapping: { [impl]: corrigir }
    })
    expect(raw(h.db, id)).toMatchObject({
      flow_id: h.ids.flows.Bugfix,
      stage_id: corrigir,
      touched_at: h.nowIso(),
      done_at: null
    })
    expect(r.row!.stage.name).toBe('Corrigir')
    expect(r.row!.touched_at).toBe(h.nowIso())
    const a = readActivity(h.db, r.activity_id!)!
    expect(a).toMatchObject({ op: 'task_set_flow', task_id: id, inverse: null })
    expect(a.data.fields).toEqual(expect.arrayContaining(['flow_id', 'stage_id']))
    expect(h.events).toContainEqual({ entity: 'task', ids: [id], op: 'upsert' })
  })

  it('o par sugerido nunca é aplicado sozinho', () => {
    const h = setup()
    const review = h.ids.stages.Feature[2]
    const id = featureAt(h, 2)
    const e = errOf(() => setTaskFlow(h.d, USER, { id, flow_id: h.ids.flows.Bugfix }))
    expect(e.details).toMatchObject({ reason: 'remap_required', missing: [review] })
    expect((e.details?.preview as StagePairing[])[2].to_stage_id).toBe(h.ids.stages.Bugfix[2])
    expect(raw(h.db, id).flow_id).toBe(h.ids.flows.Feature)
  })

  it('par fora do fluxo novo: VALIDATION sem escrever', () => {
    const h = setup()
    const impl = h.ids.stages.Feature[1]
    const id = featureAt(h, 1)
    const before = dumpTables(h.db, DUMP)
    const e = errOf(() =>
      setTaskFlow(h.d, USER, {
        id,
        flow_id: h.ids.flows.Bugfix,
        mapping: { [impl]: h.ids.stages.Pessoal[0] }
      })
    )
    expect([e.code, e.details?.reason]).toEqual(['VALIDATION', 'stage_not_in_flow'])
    expect(dumpTables(h.db, DUMP)).toEqual(before)
  })

  it('ir para a final grava done_at; sair dela limpa', () => {
    const h = setup()
    const review = h.ids.stages.Feature[2]
    const [, , , bEntregue] = h.ids.stages.Bugfix
    const id = featureAt(h, 2)
    h.tick(MIN)
    setTaskFlow(h.d, USER, { id, flow_id: h.ids.flows.Bugfix, mapping: { [review]: bEntregue } })
    expect(raw(h.db, id).done_at).toBe(h.nowIso())
    setTaskFlow(h.d, USER, {
      id,
      flow_id: h.ids.flows.Feature,
      mapping: { [bEntregue]: review }
    })
    expect(raw(h.db, id).done_at).toBeNull()
  })

  it('mesmo fluxo é no-op', () => {
    const h = setup()
    const id = featureAt(h, 1)
    const before = dumpTables(h.db, DUMP)
    h.events.length = 0
    h.tick(MIN)
    const r = setTaskFlow(h.d, USER, { id, flow_id: h.ids.flows.Feature })
    expect(r.activity_id).toBeNull()
    expect(r.row!.id).toBe(id)
    expect(dumpTables(h.db, DUMP)).toEqual(before)
    expect(h.events).toEqual([])
  })

  it('task apagada e fluxo inexistente: NOT_FOUND', () => {
    const h = setup()
    const id = featureAt(h, 1)
    expect(errOf(() => setTaskFlow(h.d, USER, { id, flow_id: 'nada' })).code).toBe('NOT_FOUND')
    deleteTask(h.d, USER, { id })
    expect(errOf(() => setTaskFlow(h.d, USER, { id, flow_id: h.ids.flows.Bugfix })).code).toBe(
      'NOT_FOUND'
    )
  })
})

describe('remapTarget', () => {
  it('devolve a etapa do mapping ou a prévia com a etapa atual faltando', () => {
    const h = setup()
    const impl = h.ids.stages.Feature[1]
    const corrigir = h.ids.stages.Bugfix[1]
    const rec = raw(h.db, featureAt(h, 1))
    expect(remapTarget(h.d, rec, h.ids.flows.Bugfix, { [impl]: corrigir })).toEqual({
      stage_id: corrigir
    })
    // par de outra etapa não conta
    const r = remapTarget(h.d, rec, h.ids.flows.Bugfix, { [h.ids.stages.Feature[0]]: corrigir })
    expect(r).toMatchObject({ missing: [impl] })
  })

  it('fluxo de destino inexistente: NOT_FOUND, com ou sem mapping', () => {
    const h = setup()
    const impl = h.ids.stages.Feature[1]
    const rec = raw(h.db, featureAt(h, 1))
    for (const m of [undefined, { [impl]: h.ids.stages.Bugfix[1] }]) {
      const e = errOf(() => remapTarget(h.d, rec, 'nada', m))
      expect([e.code, e.details?.entity]).toEqual(['NOT_FOUND', 'flow'])
    }
  })
})
