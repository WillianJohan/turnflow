import {
  Limits,
  type ImportConflict,
  type ImportPreview,
  type ImportPreviewTask,
  type ImportTaskAction
} from '../../../shared/contracts'
import { IMPORT_COPY } from '../../../shared/copy/import'
import { isAbsolutePath } from '../../../shared/pathSyntax'
import { fold } from '../../db/fold'
import type { Db } from '../../db/open'
import { checkpointHash } from '../../domain/checkpoint'
import type { DomainDeps } from '../../domain/context'
import { notFound } from '../../domain/errors'
import {
  appendLinks,
  IMPORT_SESSION_TOOL,
  type ImportCheckpoint,
  type ImportSession,
  type ImportStage,
  type ImportTaskCreate,
  type ImportTaskUpdate
} from '../../domain/importTask'
import type { TaskRecord } from '../../domain/rows'
import { parseTaskReadme, type ParsedTask } from './parse'
import {
  appValuesOf,
  emptyHashes,
  mdValues,
  recordReader,
  SCALAR_FIELDS,
  sha,
  type FieldHashes,
  type ImportRecord,
  type ScalarField
} from './record'
import type { BrainScan, ScannedTask } from './scan'
import {
  resolveStatus,
  statusKey,
  suggestTarget,
  type FlowStageLite,
  type StatusMapFile,
  type StatusMapProblem
} from './statusMap'

// Plano do import (E4): lê o banco e o scan e decide, por task, criar, atualizar, vincular ou nada,
// campo a campo. Não escreve nada. O `token` resume tudo o que o apply faria: muda sempre que uma
// operação muda, seja pelo markdown, pelas opções ou pelo estado do banco.

export type ImportOptions = {
  type_id?: string
  status_map: StatusMapFile
  /** O que o `readStatusMap` achou do arquivo salvo; vai para a prévia (`preview.status_map`). */
  status_map_health?: { problem?: StatusMapProblem; dropped: number }
  take_markdown?: { key: string; field: ScalarField }[]
  workdirs?: Record<string, string>
}

export type ProjectRef = { source_key: string; name: string }

/**
 * `project: undefined` = não mexe no projeto; `null` = tira do projeto. Com um `ProjectRef`, o
 * apply resolve o id (reusa ou cria) e grava `record.field_hashes.project.app = sha(id)`: o plano só
 * conhece o id de projeto que já existe e deixa `''` no lugar quando o projeto ainda vai nascer.
 */
export type PlannedTask =
  | {
      kind: 'create'
      key: string
      project: ProjectRef | null
      create: Omit<ImportTaskCreate, 'project_id'>
      record: Omit<ImportRecord, 'task_id' | 'imported_at'>
    }
  | {
      kind: 'update'
      key: string
      task_id: string
      project: ProjectRef | null | undefined
      update: Omit<ImportTaskUpdate, 'set'> & {
        set?: Omit<NonNullable<ImportTaskUpdate['set']>, 'project_id'>
      }
      record: Omit<ImportRecord, 'imported_at'>
      /** Conflitos resolvidos com o markdown (`take_markdown`): vão para o relatório. */
      taken?: ScalarField[]
    }
  | { kind: 'none'; key: string }

export type ImportPlan = { preview: ImportPreview; tasks: PlannedTask[]; projects: ProjectRef[] }

type ProjectAction = 'create' | 'existing' | 'deleted_in_app'
type ProjectInfo = {
  ref: ProjectRef
  action: ProjectAction
  /** Id do projeto no app (só em `existing`). */
  id: string | null
  flow_id: string | null
  /** Nome que a prévia mostra: o do app quando o projeto já existe. */
  display: string
}

type TypeLite = { id: string; name: string; flow_id: string }

/** Statements do plano, preparados uma vez por prévia (não dentro dos laços). */
type Stmt = ReturnType<Db['prepare']>
type Queries = {
  record: (sourceKey: string) => ImportRecord | null
} & Record<
  | 'taskById'
  | 'taskByKey'
  | 'importProject'
  | 'project'
  | 'stages'
  | 'stageName'
  | 'session'
  | 'checkpoint',
  Stmt
>

function prepareQueries(db: Db): Queries {
  return {
    record: recordReader(db),
    taskById: db.prepare('select * from task where id = ?'),
    taskByKey: db.prepare('select * from task where key = ?'),
    importProject: db.prepare('select project_id from import_project where source_key = ?'),
    project: db.prepare('select id, name, flow_id from project where id = ?'),
    stages: db.prepare(
      `select id, name, short_name, position, waits_other, is_final from flow_stage
       where flow_id = ? and deleted_at is null order by position, id`
    ),
    stageName: db.prepare('select name from flow_stage where id = ?'),
    session: db.prepare('select task_id, label from ai_session where tool = ? and external_id = ?'),
    checkpoint: db.prepare(
      'select 1 from checkpoint where task_id = ? and substr(at, 1, 10) = ? and text_hash = ?'
    )
  }
}

type Ctx = {
  db: Db
  q: Queries
  o: ImportOptions
  type: TypeLite
  types: TypeLite[]
  parsed: Map<string, ParsedTask>
  parents: Set<string>
  stages: Map<string, FlowStageLite[]>
  take: Set<string>
}

type Outcome = { op: PlannedTask; row: ImportPreviewTask; project: ProjectInfo | null }

export function planImport(d: DomainDeps, scan: BrainScan, o: ImportOptions): ImportPlan {
  const types = d.db
    .prepare('select id, name, flow_id from task_type order by rowid')
    .all() as TypeLite[]
  const type = chooseType(d.db, types, o.type_id)
  const parsed = new Map(scan.tasks.map((t) => [t.key, parseTaskReadme(t.text, t.key)]))
  const parents = new Set(
    [...parsed.values()].flatMap((p) => (p.parent ? [p.parent.toUpperCase()] : []))
  )
  const c: Ctx = {
    db: d.db,
    q: prepareQueries(d.db),
    o,
    type,
    types,
    parsed,
    parents,
    stages: new Map(),
    take: new Set((o.take_markdown ?? []).map((t) => takeKey(t.key, t.field)))
  }

  const outcomes = scan.tasks.map((t) => planTask(c, t))
  const tasks = outcomes.map((x) => x.op)
  const rows = outcomes.map((x) => x.row)

  const used = new Map<string, ProjectInfo>()
  for (const x of outcomes) if (x.project) used.set(x.project.ref.source_key, x.project)
  const projectInfos = [...used.values()].sort((a, b) =>
    a.ref.source_key < b.ref.source_key ? -1 : a.ref.source_key > b.ref.source_key ? 1 : 0
  )
  const projects = projectInfos.filter((p) => p.action !== 'deleted_in_app').map((p) => p.ref)

  const count = (a: ImportTaskAction): number => rows.filter((r) => r.action === a).length
  const preview: ImportPreview = {
    root: scan.root,
    token: sha(JSON.stringify({ tasks, projects, rows })),
    type_id: type.id,
    flow_id: type.flow_id,
    stages: stagesOf(c, type.flow_id).map((s) => ({ id: s.id, name: s.name })),
    status_map: {
      problem: o.status_map_health?.problem ?? null,
      dropped: o.status_map_health?.dropped ?? 0
    },
    statuses: statusRows(c, scan),
    tasks: rows,
    projects: projectInfos.map((p) => ({
      source_key: p.ref.source_key,
      name: p.display,
      action: p.action
    })),
    attachments: scan.tasks.flatMap((t) => t.attachments),
    ignored: scan.ignored.map((i) => ({
      path: i.path,
      reason: i.reason,
      ...(i.count !== undefined ? { count: i.count } : {})
    })),
    counts: {
      create: count('create'),
      update: count('update'),
      link: count('link'),
      record_only: count('record_only'),
      unchanged: count('unchanged'),
      deleted_in_app: count('deleted_in_app'),
      invalid: count('invalid'),
      conflicts: rows.reduce((n, r) => n + r.conflicts.length, 0)
    }
  }
  return { preview, tasks, projects }
}

/** Tipo único do import (Decisão 10): o escolhido, senão o primeiro tipo do fluxo padrão. */
function chooseType(db: Db, types: TypeLite[], typeId: string | undefined): TypeLite {
  if (typeId !== undefined) {
    const t = types.find((x) => x.id === typeId)
    if (!t) throw notFound('type', typeId)
    return t
  }
  const def = db
    .prepare(
      `select y.id, y.name, y.flow_id from task_type y join flow f on f.id = y.flow_id
       where f.is_default = 1 order by y.rowid limit 1`
    )
    .get() as TypeLite | undefined
  if (!def) throw notFound('type', null)
  return def
}

function stagesOf(c: Ctx, flowId: string): FlowStageLite[] {
  let s = c.stages.get(flowId)
  if (!s) {
    s = (
      c.q.stages.all(flowId) as (Omit<FlowStageLite, 'waits_other' | 'is_final'> & {
        waits_other: number
        is_final: number
      })[]
    ).map((r) => ({ ...r, waits_other: r.waits_other === 1, is_final: r.is_final === 1 }))
    c.stages.set(flowId, s)
  }
  return s
}

/** Um por chave de status de `current`/`backlog`, na ordem do scan, com a sugestão e a fonte. */
function statusRows(c: Ctx, scan: BrainScan): ImportPreview['statuses'] {
  const stages = stagesOf(c, c.type.flow_id)
  const out = new Map<string, ImportPreview['statuses'][number]>()
  for (const t of scan.tasks) {
    const status = c.parsed.get(t.key)!.status
    if (t.dir === 'done' || status === null) continue
    const key = statusKey(status)
    if (key === '') continue
    const cur = out.get(key)
    if (cur) {
      cur.count++
      continue
    }
    const { target, source } = suggestTarget(key, c.o.status_map, stages)
    out.set(key, { status: status.split(':')[0]!.trim(), key, count: 1, target, source })
  }
  return [...out.values()]
}

const takeKey = (key: string, field: ScalarField): string => `${key}\u0000${field}`

/** A task pai entra no próprio projeto (Decisão 11), salvo se já tem Pai ou Project. */
function effective(c: Ctx, p: ParsedTask): ParsedTask {
  if (p.parent || p.project_name?.trim() || !c.parents.has(p.key)) return p
  return { ...p, parent: p.key }
}

/** Projeto que o markdown pede (Decisão 11): por Pai (`key:`) ou por `**Project:**` (`name:`). */
function projectFor(c: Ctx, p: ParsedTask): ProjectInfo | null {
  let ref: ProjectRef
  if (p.parent) {
    const key = p.parent.toUpperCase()
    const title = c.parsed.get(key)?.title.trim()
    ref = { source_key: `key:${key}`, name: title && title.length <= Limits.name ? title : key }
  } else {
    const name = p.project_name?.trim()
    if (!name) return null
    ref = { source_key: `name:${fold(name)}`, name }
  }
  const link = c.q.importProject.get(ref.source_key) as { project_id: string | null } | undefined
  if (!link) return { ref, action: 'create', id: null, flow_id: null, display: ref.name }
  const proj =
    link.project_id === null
      ? undefined
      : (c.q.project.get(link.project_id) as
          { id: string; name: string; flow_id: string | null } | undefined)
  if (!proj) return { ref, action: 'deleted_in_app', id: null, flow_id: null, display: ref.name }
  return { ref, action: 'existing', id: proj.id, flow_id: proj.flow_id, display: proj.name }
}

const normReason = (r: string | null): string | null => {
  const t = r?.trim() ?? ''
  return t === '' ? null : t
}

/** Mesmo `(dia, hash do texto)` dentro da própria lista conta uma vez (como o `importTask`). */
function dedupCheckpoints(list: ImportCheckpoint[]): ImportCheckpoint[] {
  const seen = new Set<string>()
  return list.filter((cp) => {
    const k = `${cp.at.slice(0, 10)}|${checkpointHash(cp.text)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Linhas de link únicas por URL, na ordem do arquivo. */
function linkLines(p: ParsedTask): { line: string; url: string }[] {
  const seen = new Set<string>()
  return p.links.filter((l) => !seen.has(l.url) && (seen.add(l.url), true))
}

const maxAt = (xs: string[]): string | null =>
  xs.reduce<string | null>((m, x) => (m === null || x > m ? x : m), null)
const minAt = (xs: string[]): string | null =>
  xs.reduce<string | null>((m, x) => (m === null || x < m ? x : m), null)
const plusSecond = (iso: string): string => new Date(Date.parse(iso) + 1000).toISOString()

/** Checkpoint `Imported status: X` quando o status não tem mapeamento (Decisão 7). */
function statusCheckpoint(
  p: ParsedTask,
  mapped: boolean,
  fallbackAt: string
): ImportCheckpoint | null {
  if (mapped || p.status === null) return null
  const last = maxAt(p.checkpoints.map((x) => x.at))
  return {
    at: last === null ? fallbackAt : plusSecond(last),
    text: IMPORT_COPY.importedStatus(p.status)
  }
}

/** Primeiro campo acima do `Limits` (Decisão 13), ou `null`. */
function tooLong(v: {
  title: string
  description: string | null
  checkpoints: ImportCheckpoint[]
  blocked_reason: string | null
  workdir: string | null
  project: ProjectInfo | null
}): string | null {
  if (v.title.length > Limits.title) return 'too_long:title'
  if ((v.description ?? '').length > Limits.description) return 'too_long:description'
  if (v.checkpoints.some((x) => x.text.trim().length > Limits.checkpoint))
    return 'too_long:checkpoint'
  if ((v.blocked_reason?.length ?? 0) > Limits.reason) return 'too_long:blocked_reason'
  if (v.workdir !== null) {
    if (v.workdir.length > Limits.workdir) return 'too_long:workdir'
    if (!isAbsolutePath(v.workdir)) return 'workdir_relative'
  }
  if (v.project && v.project.ref.name.length > Limits.name) return 'too_long:project'
  return null
}

function baseRow(t: ScannedTask, p: ParsedTask): ImportPreviewTask {
  return {
    key: t.key,
    title: p.title,
    dir: t.dir,
    action: 'unchanged',
    fields: [],
    conflicts: [],
    new_checkpoints: 0,
    new_sessions: 0,
    new_links: 0,
    project: null,
    workdir_hint: p.workdir_hint,
    reason: null
  }
}

const none = (key: string): PlannedTask => ({ kind: 'none', key })

function planTask(c: Ctx, t: ScannedTask): Outcome {
  const p = c.parsed.get(t.key)!
  const row = baseRow(t, p)
  const nothing = (action: ImportTaskAction, reason: string | null = null): Outcome => ({
    op: none(t.key),
    row: { ...row, action, reason },
    project: null
  })
  const workdir = c.o.workdirs?.[t.key] || null

  const rec = c.q.record(t.key)
  if (rec) {
    const task =
      rec.task_id === null ? undefined : (c.q.taskById.get(rec.task_id) as TaskRecord | undefined)
    if (!task || task.deleted_at !== null) return nothing('deleted_in_app')
    if (rec.file_hash === t.file_hash && rec.source_path === t.source_path) {
      // Decisão 31: conteúdo e lugar iguais. Só a pasta escolhida agora pode mudar algo.
      if (workdir === null || task.workdir) return nothing('unchanged')
      const bad = tooLong({ ...EMPTY_CHECK, title: '', workdir })
      if (bad) return nothing('invalid', bad)
      const record = {
        source_key: rec.source_key,
        source_path: rec.source_path,
        task_id: rec.task_id,
        file_hash: rec.file_hash,
        field_hashes: rec.field_hashes
      }
      return {
        op: {
          kind: 'update',
          key: t.key,
          task_id: task.id,
          project: undefined,
          update: { task_id: task.id, workdir },
          record
        },
        row: { ...row, action: 'update', fields: ['workdir'] },
        project: null
      }
    }
    return planMerge(c, t, p, task, rec.field_hashes, 'update', workdir, row)
  }
  const byKey = c.q.taskByKey.get(t.key) as TaskRecord | undefined
  if (byKey && byKey.deleted_at !== null) return nothing('deleted_in_app')
  // Decisão 18: key que já existe sem record vincula; hashes vazios = tudo diferente vira conflito.
  if (byKey) return planMerge(c, t, p, byKey, emptyHashes(), 'link', workdir, row)
  return planCreate(c, t, p, workdir, row)
}

const EMPTY_CHECK = {
  description: null,
  checkpoints: [],
  blocked_reason: null,
  project: null
}

function planCreate(
  c: Ctx,
  t: ScannedTask,
  raw: ParsedTask,
  workdir: string | null,
  row: ImportPreviewTask
): Outcome {
  const p = effective(c, raw)
  const project = projectFor(c, p)
  const typeByName = raw.type_name
    ? c.types.find((y) => fold(y.name) === fold(raw.type_name!.trim()))
    : undefined
  const type = typeByName ?? c.type
  const flowId = (project?.action === 'existing' ? project.flow_id : null) ?? type.flow_id
  const res = resolveStatus(
    { status: p.status, dir: t.dir, blocked: p.blocked },
    c.o.status_map,
    stagesOf(c, flowId)
  )
  const stage: ImportStage = {
    stage_id: res.stage_id,
    blocked_reason: normReason(res.blocked_reason)
  }

  const links = linkLines(p)
  const description =
    appendLinks(
      p.description || null,
      links.map((l) => l.line)
    ) || null
  const dated = [...p.checkpoints.map((x) => x.at), ...p.sessions.map((s) => s.at)]
  const created_at = minAt(dated) ?? t.mtime
  const extra = statusCheckpoint(p, res.mapped, created_at)
  const checkpoints = dedupCheckpoints([...p.checkpoints, ...(extra ? [extra] : [])])
  const touched_at = maxAt(checkpoints.map((x) => x.at)) ?? created_at
  const sessions: ImportSession[] = p.sessions.map((s) => ({
    external_id: s.external_id,
    at: s.at,
    label: s.label
  }))

  const bad = tooLong({
    title: p.title.trim(),
    description,
    checkpoints,
    blocked_reason: stage.blocked_reason,
    workdir,
    project
  })
  const keep = project && project.action !== 'deleted_in_app' ? project : null
  const outRow: ImportPreviewTask = {
    ...row,
    project: keep?.display ?? null,
    new_checkpoints: checkpoints.length,
    new_sessions: sessions.filter((s) => sessionState(c, null, s) === 'new').length,
    new_links: links.length
  }
  if (bad)
    return { op: none(t.key), row: { ...outRow, action: 'invalid', reason: bad }, project: null }

  const md = mdValues(p, t.dir)
  const app = appValuesOf({
    title: p.title.trim(),
    description,
    project_id: keep?.id ?? null,
    stage_id: stage.stage_id,
    blocked_reason: stage.blocked_reason
  })
  const field_hashes: FieldHashes = { ...emptyHashes(), links: links.map((l) => l.url) }
  for (const f of SCALAR_FIELDS) field_hashes[f] = { md: sha(md[f]), app: sha(app[f]) }
  // projeto que ainda vai nascer: o apply grava o hash do id que criar
  if (keep && keep.id === null) field_hashes.project.app = ''

  return {
    op: {
      kind: 'create',
      key: t.key,
      project: keep?.ref ?? null,
      create: {
        key: t.key,
        title: p.title.trim(),
        description,
        type_id: type.id,
        flow_id: flowId,
        stage,
        workdir,
        created_at,
        touched_at,
        checkpoints,
        sessions
      },
      record: {
        source_key: t.key,
        source_path: t.source_path,
        file_hash: t.file_hash,
        field_hashes
      }
    },
    row: { ...outRow, action: 'create' },
    project
  }
}

type SessionState = 'new' | 'same' | 'label' | 'taken'

/** Como o `importTask` vai tratar a sessão (Decisão 14): nova (ou órfã adotada), igual, rótulo, de outra task. */
function sessionState(c: Ctx, taskId: string | null, s: ImportSession): SessionState {
  const r = c.q.session.get(IMPORT_SESSION_TOOL, s.external_id) as
    { task_id: string | null; label: string | null } | undefined
  if (!r || r.task_id === null) return 'new'
  if (r.task_id !== taskId) return 'taken'
  return r.label === s.label ? 'same' : 'label'
}

const hasCheckpoint = (c: Ctx, taskId: string, cp: ImportCheckpoint): boolean =>
  c.q.checkpoint.get(taskId, cp.at.slice(0, 10), checkpointHash(cp.text)) !== undefined

function stageLabel(c: Ctx, stageId: string, reason: string | null): string {
  const s = c.q.stageName.get(stageId) as { name: string } | undefined
  const name = s?.name ?? stageId
  return reason ? `${name}: ${reason}` : name
}

function projectLabel(c: Ctx, id: string | null): string {
  if (id === null) return ''
  const r = c.q.project.get(id) as { name: string } | undefined
  return r?.name ?? ''
}

/**
 * Merge por campo (§11, Decisões 2, 3 e 12). Mudou só no md: escreve. Mudou nos dois: conflito, o
 * app fica (salvo `take_markdown`) e só o `md` do record anda. O `app` do record só anda quando o
 * import escreve o campo: campo editado no app continua marcado como editado, e um conflito mantido
 * volta quando o md mudar de novo.
 */
function planMerge(
  c: Ctx,
  t: ScannedTask,
  raw: ParsedTask,
  task: TaskRecord,
  base: FieldHashes,
  mode: 'update' | 'link',
  workdirOpt: string | null,
  row: ImportPreviewTask
): Outcome {
  const p = effective(c, raw)
  const project = projectFor(c, p)
  const res = resolveStatus(
    { status: p.status, dir: t.dir, blocked: p.blocked },
    c.o.status_map,
    stagesOf(c, task.flow_id)
  )
  const stage: ImportStage = {
    stage_id: res.stage_id,
    blocked_reason: normReason(res.blocked_reason)
  }
  const keep = project && project.action !== 'deleted_in_app' ? project : null
  const links = linkLines(p)
  const known = new Set(base.links)
  const newLinks = links.filter((l) => !known.has(l.url))

  const md = mdValues(p, t.dir)
  const app = appValuesOf(task)
  const desired: Record<ScalarField, string> = {
    title: p.title.trim(),
    description: appendLinks(
      p.description || null,
      links.map((l) => l.line)
    ),
    // projeto que ainda vai nascer nunca é igual ao do app
    project: keep ? (keep.id ?? `new:${keep.ref.source_key}`) : '',
    stage: `${stage.stage_id}|${stage.blocked_reason ?? ''}`
  }

  const hashes: FieldHashes = {
    ...emptyHashes(),
    links: [...base.links, ...newLinks.map((l) => l.url)]
  }
  const write = new Set<ScalarField>()
  const taken: ScalarField[] = []
  const convergent = new Set<ScalarField>()
  const conflicts: ImportConflict[] = []
  for (const f of SCALAR_FIELDS) {
    hashes[f] = { md: sha(md[f]), app: base[f].app }
    if (sha(md[f]) === base[f].md) continue
    if (desired[f] === app[f]) {
      convergent.add(f)
      hashes[f].app = sha(app[f])
      continue
    }
    const editedInApp = sha(app[f]) !== base[f].app
    if (editedInApp && !c.take.has(takeKey(t.key, f))) {
      conflicts.push({
        key: t.key,
        field: f,
        app: shown(c, f, 'app', task, p, keep, stage),
        markdown: shown(c, f, 'md', task, p, keep, stage)
      })
      continue
    }
    if (editedInApp) taken.push(f)
    write.add(f)
    hashes[f].app = f === 'project' && keep && keep.id === null ? '' : sha(desired[f])
  }

  const set: NonNullable<Extract<PlannedTask, { kind: 'update' }>['update']['set']> = {}
  if (write.has('title')) set.title = desired.title
  if (write.has('description')) set.description = desired.description
  if (write.has('stage')) set.stage = stage
  const projectOp = write.has('project') ? (keep?.ref ?? null) : undefined

  // links novos sem reescrever a descrição: entram no bloco `## Links` do que o app tem
  const append =
    !write.has('description') && !convergent.has('description') ? newLinks.map((l) => l.line) : []
  let finalDescription = write.has('description') ? desired.description : task.description
  if (append.length > 0) {
    finalDescription = appendLinks(task.description, append)
    // descrição editada no app continua marcada como editada; senão o hash acompanha o acréscimo
    if (sha(app.description) === base.description.app)
      hashes.description.app = sha(finalDescription)
  }

  const extra = write.has('stage') ? statusCheckpoint(p, res.mapped, task.created_at) : null
  const allCps = dedupCheckpoints([...p.checkpoints, ...(extra ? [extra] : [])])
  const freshCps = allCps.filter((x) => !hasCheckpoint(c, task.id, x))
  const states = p.sessions.map((s) => sessionState(c, task.id, s))
  const sessionsMatter = states.some((s) => s !== 'same')
  const workdir = workdirOpt !== null && !task.workdir ? workdirOpt : null

  const bad = tooLong({
    title: write.has('title') ? desired.title : '',
    description: finalDescription,
    checkpoints: allCps,
    blocked_reason: write.has('stage') ? stage.blocked_reason : null,
    workdir,
    project: write.has('project') ? project : null
  })

  const fields: string[] = [
    ...SCALAR_FIELDS.filter((f) => write.has(f)),
    ...(workdir ? ['workdir'] : [])
  ]
  const outRow: ImportPreviewTask = {
    ...row,
    fields,
    conflicts,
    project: keep?.display ?? null,
    new_checkpoints: freshCps.length,
    new_sessions: states.filter((s) => s === 'new').length,
    new_links: newLinks.length
  }
  if (bad)
    return {
      op: none(t.key),
      row: { ...outRow, fields: [], conflicts: [], action: 'invalid', reason: bad },
      project: null
    }

  const update: Extract<PlannedTask, { kind: 'update' }>['update'] = { task_id: task.id }
  if (Object.keys(set).length > 0) update.set = set
  if (append.length > 0) update.append_links = append
  if (freshCps.length > 0) update.checkpoints = freshCps
  if (sessionsMatter)
    update.sessions = p.sessions.map((s) => ({
      external_id: s.external_id,
      at: s.at,
      label: s.label
    }))
  if (workdir) update.workdir = workdir

  // O merge só roda com hash ou path diferentes, então o record sempre é gravado. A ação diz se a
  // task também é: conflito mantido sozinho não escreve na task (só o `md` do record anda).
  const writesTask =
    fields.length > 0 ||
    append.length > 0 ||
    freshCps.length > 0 ||
    states.some((s) => s === 'new' || s === 'label')
  const action: ImportTaskAction = mode === 'link' ? 'link' : writesTask ? 'update' : 'record_only'
  return {
    op: {
      kind: 'update',
      key: t.key,
      task_id: task.id,
      project: projectOp,
      update,
      record: {
        source_key: t.key,
        source_path: t.source_path,
        task_id: task.id,
        file_hash: t.file_hash,
        field_hashes: hashes
      },
      ...(taken.length > 0 ? { taken } : {})
    },
    row: { ...outRow, action },
    project: projectOp !== undefined ? project : null
  }
}

/** Valor legível de um campo em conflito, de cada lado. */
function shown(
  c: Ctx,
  f: ScalarField,
  side: 'app' | 'md',
  task: TaskRecord,
  p: ParsedTask,
  keep: ProjectInfo | null,
  stage: ImportStage
): string {
  if (side === 'app') {
    if (f === 'title') return task.title
    if (f === 'description') return task.description ?? ''
    if (f === 'project') return projectLabel(c, task.project_id)
    return stageLabel(c, task.stage_id, task.blocked_reason)
  }
  if (f === 'title') return p.title.trim()
  if (f === 'description')
    return appendLinks(
      p.description || null,
      linkLines(p).map((l) => l.line)
    )
  if (f === 'project') return keep?.display ?? ''
  return stageLabel(c, stage.stage_id, stage.blocked_reason)
}
