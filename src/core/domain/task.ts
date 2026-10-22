import { Limits, type CreateTaskInput, type TaskPatch, type TaskRow } from '../../shared/contracts'
import { isAbsolutePath } from '../../shared/pathSyntax'
import type { Db } from '../db/open'
import { readFields, recordActivity, type Inverse, type TaskField } from './activity'
import { emitCounters, nowIso, touchExpr, type Actor, type DomainDeps, type Emit } from './context'
import { checkMax, domainError, notFound } from './errors'
import { rankAfter } from './rank'
import { raiseTurn } from './turn'
import { liveTask, taskRow, type TaskRecord } from './rows'

/** `row` é `null` quando a task termina apagada (Decisão 28). */
export type TaskCommandResult = { row: TaskRow | null; activity_id: string | null }

/** Resultado do miolo de uma operação sobre uma task (sem `tx`, Decisão 27). */
export type TaskWrite = { task_id: string; activity_id: string | null }

export function createTask(d: DomainDeps, actor: Actor, i: CreateTaskInput): TaskCommandResult {
  return finish(
    d,
    d.tx((emit) => createTaskIn(d, emit, actor, i))
  )
}

export function updateTask(
  d: DomainDeps,
  actor: Actor,
  id: string,
  patch: TaskPatch
): TaskCommandResult {
  return finish(
    d,
    d.tx((emit) => updateTaskIn(d, emit, actor, id, patch))
  )
}

/**
 * Cria a task no fluxo `project.flow ?? type.flow` (congelado daqui em diante), na primeira etapa
 * viva, com a próxima key `T-n`. Tipo omitido = tipo do fluxo padrão (Decisão 6). Com projeto, o
 * item entra no fim da lista do projeto.
 */
export function createTaskIn(
  d: DomainDeps,
  emit: Emit,
  actor: Actor,
  i: CreateTaskInput
): TaskWrite {
  const { db } = d
  const title = cleanTitle(i.title)
  const description = cleanDescription(i.description)
  const workdir = cleanWorkdir(i.workdir)

  const project = i.project_id
    ? (db.prepare('select id, flow_id from project where id = ?').get(i.project_id) as
        { id: string; flow_id: string | null } | undefined)
    : undefined
  if (i.project_id && !project) throw notFound('project', i.project_id)

  const type = (
    i.type_id !== undefined
      ? db.prepare('select id, flow_id from task_type where id = ?').get(i.type_id)
      : db
          .prepare(
            `select y.id, y.flow_id from task_type y join flow f on f.id = y.flow_id
             where f.is_default = 1 order by y.rowid limit 1`
          )
          .get()
  ) as { id: string; flow_id: string } | undefined
  if (!type) throw notFound('type', i.type_id ?? null)

  const flowId = project?.flow_id ?? type.flow_id
  const stage = db
    .prepare(
      `select id, is_final from flow_stage where flow_id = ? and deleted_at is null
       order by position, id limit 1`
    )
    .get(flowId) as { id: string; is_final: number } | undefined
  if (!stage) throw notFound('stage', flowId)

  const now = nowIso(d)
  const id = d.newId()
  const key = nextKey(db)
  db.prepare(
    `insert into task(id, key, title, description, type_id, flow_id, stage_id, project_id, workdir,
                      done_at, touched_at, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    key,
    title,
    description,
    type.id,
    flowId,
    stage.id,
    project?.id ?? null,
    workdir,
    stage.is_final ? now : null,
    now,
    now
  )
  emit({ entity: 'task', ids: [id], op: 'upsert' })

  if (project) {
    appendProjectItem(d, project.id, id)
    emit({ entity: 'project', ids: [project.id], op: 'upsert' })
  }

  const activity_id = recordActivity(d, emit, actor, {
    op: 'task_create',
    task_id: id,
    fields: [],
    inverse: null,
    data: { key }
  })
  return { task_id: id, activity_id }
}

const EDIT_FIELDS = [
  'title',
  'description',
  'sum_what',
  'sum_where',
  'sum_next',
  'workdir'
] as const
type EditField = (typeof EDIT_FIELDS)[number]
const SUM_FIELDS: ReadonlySet<EditField> = new Set(['sum_what', 'sum_where', 'sum_next'])

/**
 * Edita só o que mudou. Mudou algo: toca `touched_at`, grava 1 `task_update` sem inverso com
 * `fields` = chaves mudadas; `sum_*` grava `sum_at` e `sum_source` pelo ator. Nada mudou: no-op
 * (sem escrita, sem evento, `activity_id: null`, Decisão 10).
 */
export function updateTaskIn(
  d: DomainDeps,
  emit: Emit,
  actor: Actor,
  id: string,
  patch: TaskPatch
): TaskWrite {
  const rec = liveTask(d.db, id)
  const next = normalizePatch(patch)
  const changed = EDIT_FIELDS.filter((f) => f in next && next[f] !== rec[f])
  if (changed.length === 0) return { task_id: rec.id, activity_id: null }

  const now = nowIso(d)
  const set = changed.map((f) => `${f} = @${f}`)
  const values: Record<string, string | null> = { id: rec.id, now }
  for (const f of changed) values[f] = next[f] ?? null
  if (changed.some((f) => SUM_FIELDS.has(f))) {
    set.push('sum_at = @now', 'sum_source = @sum_source')
    values.sum_source = sumSource(actor)
  }
  d.db.prepare(`update task set ${set.join(', ')}, touched_at = @now where id = @id`).run(values)
  emit({ entity: 'task', ids: [rec.id], op: 'upsert' })

  const activity_id = recordActivity(d, emit, actor, {
    op: 'task_update',
    task_id: rec.id,
    fields: [...changed],
    inverse: null
  })
  return { task_id: rec.id, activity_id }
}

type StageInfo = { id: string; position: number; name: string; is_final: number }
type Outbox = 'queued' | 'none'
type StageResult = { activity_id: string | null; outbox: Outbox }

export function setStage(
  d: DomainDeps,
  actor: Actor,
  i: { id: string; stage_id: string }
): TaskCommandResult & { outbox: Outbox } {
  const r = d.tx((emit) => {
    const w = setStageIn(d, emit, actor, i)
    return { ...w, task_id: liveTask(d.db, i.id).id }
  })
  return { ...finish(d, r), outbox: r.outbox }
}

/**
 * Muda a etapa (Decisões 11, 12 e 13). `done_at` acompanha `is_final`; posição menor com ator IA
 * liga `voltou`, posição maior limpa a vez. Mesma etapa é no-op. Com tipo `syncs=1` e task
 * vinculada, enfileira a linha `transition` no outbox.
 */
export function setStageIn(
  d: DomainDeps,
  emit: Emit,
  actor: Actor,
  i: { id: string; stage_id: string }
): StageResult {
  const rec = liveTask(d.db, i.id)
  const stageOf = d.db.prepare(
    'select id, position, name, is_final, deleted_at from flow_stage where id = ? and flow_id = ?'
  )
  const to = stageOf.get(i.stage_id, rec.flow_id) as
    (StageInfo & { deleted_at: string | null }) | undefined
  if (!to || to.deleted_at !== null)
    throw domainError('VALIDATION', 'stage_not_in_flow', { stage_id: i.stage_id })
  if (to.id === rec.stage_id) return { activity_id: null, outbox: 'none' }
  const from = stageOf.get(rec.stage_id, rec.flow_id) as StageInfo

  const now = nowIso(d)
  const next: Partial<Record<TaskField, string | null>> = {
    stage_id: to.id,
    done_at: to.is_final ? (rec.done_at ?? now) : null
  }
  if (to.position > from.position) {
    next.turn_reason = null
    next.turn_at = null
  } else if (to.position < from.position && actor.kind !== 'user' && actor.kind !== 'import') {
    Object.assign(next, raiseTurn(rec, 'voltou', now))
  }
  const keys = (Object.keys(next) as TaskField[]).filter(
    (k) => k === 'stage_id' || k === 'done_at' || next[k] !== rec[k]
  )
  const before = readFields(d.db, rec.id, keys)
  const expect = Object.fromEntries(keys.map((k) => [k, next[k] ?? null]))
  const set = keys.map((k) => `${k} = @${k}`).join(', ')
  d.db
    .prepare(`update task set ${set}, touched_at = ${touchExpr(actor, '@now')} where id = @id`)
    .run({ ...expect, now, id: rec.id })
  emit({ entity: 'task', ids: [rec.id], op: 'upsert' })
  emitCounters(emit, rec)

  const activity_id = d.newId()
  const outbox_id = enqueueTransition(d, rec, to.id, activity_id, now)
  const inverse: Inverse = {
    op: 'set_stage',
    task_id: rec.id,
    expect,
    restore: before,
    outbox_id
  }
  recordActivity(d, emit, actor, {
    id: activity_id,
    op: 'task_set_stage',
    task_id: rec.id,
    fields: keys,
    inverse,
    data: { from: from.name, to: to.name }
  })
  return { activity_id, outbox: outbox_id ? 'queued' : 'none' }
}

/** Linha `transition` do outbox, só para tipo que sincroniza e task vinculada (Decisão 13). */
function enqueueTransition(
  d: DomainDeps,
  rec: TaskRecord,
  toStageId: string,
  activityId: string,
  now: string
): string | null {
  const syncs = d.db.prepare('select syncs from task_type where id = ?').get(rec.type_id) as
    { syncs: number } | undefined
  if (!syncs?.syncs || !d.remote.isLinked(d.db, rec.id)) return null
  const id = d.newId()
  d.db
    .prepare(
      `insert into sync_outbox(id, task_id, op, payload, idem_key, created_at)
       values (?, ?, 'transition', ?, ?, ?)`
    )
    .run(id, rec.id, JSON.stringify({ to_stage_id: toStageId }), `transition:${activityId}`, now)
  return id
}

/** Encerra: vai para a etapa final viva de menor posição (`CONFLICT no_final_stage` se não há). */
export function closeTask(
  d: DomainDeps,
  actor: Actor,
  i: { id: string }
): TaskCommandResult & { outbox: Outbox } {
  const r = d.tx((emit) => {
    const rec = liveTask(d.db, i.id)
    const fin = d.db
      .prepare(
        `select id from flow_stage where flow_id = ? and is_final = 1 and deleted_at is null
         order by position, id limit 1`
      )
      .get(rec.flow_id) as { id: string } | undefined
    if (!fin) throw domainError('CONFLICT', 'no_final_stage')
    return { ...setStageIn(d, emit, actor, { id: rec.id, stage_id: fin.id }), task_id: rec.id }
  })
  return { ...finish(d, r), outbox: r.outbox }
}

export function deleteTask(d: DomainDeps, actor: Actor, i: { id: string }): TaskCommandResult {
  return finish(
    d,
    d.tx((emit) => deleteTaskIn(d, emit, actor, i))
  )
}

/** Apaga (soft) sem tocar `touched_at`; o inverso `undelete` devolve a task. */
export function deleteTaskIn(
  d: DomainDeps,
  emit: Emit,
  actor: Actor,
  i: { id: string }
): TaskWrite {
  const rec = liveTask(d.db, i.id)
  const now = nowIso(d)
  d.db.prepare('update task set deleted_at = ? where id = ?').run(now, rec.id)
  emit({ entity: 'task', ids: [rec.id], op: 'delete' })
  emitCounters(emit, rec)
  const activity_id = recordActivity(d, emit, actor, {
    op: 'task_delete',
    task_id: rec.id,
    fields: ['deleted_at'],
    inverse: {
      op: 'undelete',
      task_id: rec.id,
      expect: { deleted_at: now },
      restore: { deleted_at: null }
    }
  })
  return { task_id: rec.id, activity_id }
}

function finish(d: DomainDeps, w: TaskWrite): TaskCommandResult {
  return { row: taskRow(d, w.task_id), activity_id: w.activity_id }
}

/** Valida e normaliza o patch antes de qualquer escrita. */
function normalizePatch(p: TaskPatch): Partial<Pick<TaskRecord, EditField>> {
  const out: Partial<Pick<TaskRecord, EditField>> = {}
  if (p.title !== undefined) out.title = cleanTitle(p.title)
  if (p.description !== undefined) out.description = cleanDescription(p.description)
  for (const f of ['sum_what', 'sum_where', 'sum_next'] as const)
    if (p[f] !== undefined) out[f] = checkMax(f, p[f], Limits.sum)
  if (p.workdir !== undefined) out.workdir = cleanWorkdir(p.workdir)
  return out
}

function cleanTitle(v: string | null | undefined): string {
  const t = typeof v === 'string' ? v.trim() : ''
  if (t === '') throw domainError('VALIDATION', 'title_required', { field: 'title' })
  return checkMax('title', t, Limits.title)
}

/** `''` é gravado como NULL: a leitura devolve `''` para NULL e o no-op compara com o cru. */
function cleanDescription(v: string | null | undefined): string | null {
  if (v === undefined || v === null || v === '') return null
  return checkMax('description', v, Limits.description)
}

/** `''`/`null` = sem pasta própria (vale a padrão); senão absoluta (Decisão 20). */
function cleanWorkdir(v: string | null | undefined): string | null {
  if (v === undefined || v === null || v === '') return null
  checkMax('workdir', v, Limits.workdir)
  if (!isAbsolutePath(v)) throw domainError('VALIDATION', 'workdir_relative', { field: 'workdir' })
  return v
}

/** Quem escreve o resumo: a pessoa (`user`, `import`) ou uma IA (`mcp`, `assistant`, `sync`). */
function sumSource(actor: Actor): 'user' | 'ai' {
  return actor.kind === 'user' || actor.kind === 'import' ? 'user' : 'ai'
}

/**
 * Próxima key `T-n` (Decisão 7): maior entre `key_seq` e a maior `T-<dígitos>` existente, + 1,
 * gravada em `key_seq` na mesma transação. Purge da maior não faz reaproveitar; `T-7` de import é pulada.
 * Só até 15 dígitos (inteiro exato em JS): uma `T-<gigante>` importada não satura a sequência.
 */
function nextKey(db: Db): string {
  const seq = db.prepare("select last from key_seq where prefix = 'T'").get() as
    { last: number } | undefined
  const { n } = db
    .prepare(
      `select max(cast(substr(key, 3) as integer)) as n from task
       where key glob 'T-[0-9]*' and substr(key, 3) not glob '*[^0-9]*'
         and length(substr(key, 3)) <= 15`
    )
    .get() as { n: number | null }
  const next = Math.max(seq?.last ?? 0, n ?? 0) + 1
  db.prepare(
    "insert into key_seq(prefix, last) values ('T', ?) on conflict(prefix) do update set last = excluded.last"
  ).run(next)
  return `T-${next}`
}

/** Item da task no fim da lista do projeto (`rankAfter` do maior rank). */
export function appendProjectItem(d: DomainDeps, projectId: string, taskId: string): void {
  const { r } = d.db
    .prepare('select max(rank) as r from project_item where project_id = ?')
    .get(projectId) as { r: string | null }
  d.db
    .prepare(
      "insert into project_item(id, project_id, rank, kind, task_id) values (?, ?, ?, 'task', ?)"
    )
    .run(d.newId(), projectId, rankAfter(r), taskId)
}
