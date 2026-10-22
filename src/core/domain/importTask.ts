import { Limits } from '../../shared/contracts'
import { isAbsolutePath } from '../../shared/pathSyntax'
import { recordActivity } from './activity'
import { checkpointHash } from './checkpoint'
import { emitCounters, type Actor, type DomainDeps, type Emit } from './context'
import { checkMax, domainError, notFound } from './errors'
import { liveTask } from './rows'
import { appendProjectItem } from './task'

// Escrita do import (E4, Decisão 4): própria, com ator fixo `import`, uma Atividade `task_import`
// por task e sem inverso. Não toca `turn_*`. `fields` usa nome de coluna da task, porque é por ele
// que o Desfazer acha o ator do "mudou depois".

const ACTOR: Actor = { kind: 'import' }
/** Ferramenta das sessões importadas (o plano consulta o `ai_session` com ela). */
export const IMPORT_SESSION_TOOL = 'claude-code'
const TOOL = IMPORT_SESSION_TOOL

export type ImportCheckpoint = { at: string; text: string }
export type ImportSession = { external_id: string; at: string; label: string | null }
export type ImportStage = { stage_id: string; blocked_reason: string | null }

export type ImportTaskCreate = {
  key: string
  title: string
  description: string | null
  type_id: string
  flow_id: string
  stage: ImportStage
  project_id: string | null
  workdir: string | null
  created_at: string
  touched_at: string
  checkpoints: ImportCheckpoint[]
  sessions: ImportSession[]
  /** Links que o import trouxe (vai para `data.links` da Atividade); padrão 0. */
  links?: number
}

export type ImportTaskUpdate = {
  task_id: string
  set?: {
    title?: string
    description?: string | null
    project_id?: string | null
    stage?: ImportStage
  }
  append_links?: string[]
  checkpoints?: ImportCheckpoint[]
  sessions?: ImportSession[]
  workdir?: string
  /** Links novos (vão para `data.links`); padrão: `append_links.length`. */
  links?: number
}

export type ImportWriteResult = {
  task_id: string
  activity_id: string | null
  checkpoints_added: number
  sessions_added: number
  sessions_taken: { external_id: string; task_key: string }[]
  fields: string[]
}

type StageInfo = { id: string; is_final: number }

/** Cria a task com a key do markdown, no tipo e fluxo dados, e registra 1 Atividade. */
export function importCreateTaskIn(
  d: DomainDeps,
  emit: Emit,
  t: ImportTaskCreate
): ImportWriteResult {
  const title = cleanTitle(t.title)
  const description = cleanDescription(t.description)
  const workdir = cleanWorkdir(t.workdir)
  if (d.db.prepare('select 1 from task where key = ?').get(t.key) !== undefined)
    throw domainError('CONFLICT', 'key_exists', { field: 'key' })
  const blockedReason = cleanReason(t.stage.blocked_reason)
  const stage = requireStage(d, t.flow_id, t.stage.stage_id)
  const cps = cleanCheckpoints(t.checkpoints)
  if (t.project_id !== null && !projectExists(d, t.project_id))
    throw notFound('project', t.project_id)

  const id = d.newId()
  d.db
    .prepare(
      `insert into task(id, key, title, description, type_id, flow_id, stage_id, project_id, workdir,
                        blocked_reason, blocked_at, done_at, touched_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      t.key,
      title,
      description,
      t.type_id,
      t.flow_id,
      stage.id,
      t.project_id,
      workdir,
      blockedReason,
      blockedReason === null ? null : t.touched_at,
      stage.is_final ? t.touched_at : null,
      t.touched_at,
      t.created_at
    )
  bumpKeySeq(d, t.key)
  emit({ entity: 'task', ids: [id], op: 'upsert' })
  if (t.project_id !== null) appendProjectItem(d, t.project_id, id)
  emitCounters(emit, { project_id: t.project_id, flow_id: t.flow_id })

  const checkpoints_added = insertCheckpoints(d, id, cps)
  const s = syncSessions(d, id, t.sessions)
  if (checkpoints_added > 0) emit({ entity: 'task', ids: [id], op: 'upsert' })
  if (s.added > 0) emit({ entity: 'session', ids: s.ids, op: 'upsert' })

  const fields = [
    'title',
    ...(description !== null ? ['description'] : []),
    'stage_id',
    ...(stage.is_final ? ['done_at'] : []),
    ...(t.project_id !== null ? ['project_id'] : []),
    ...(blockedReason !== null ? ['blocked_reason', 'blocked_at'] : []),
    ...(workdir !== null ? ['workdir'] : [])
  ]
  const activity_id = recordActivity(d, emit, ACTOR, {
    op: 'task_import',
    task_id: id,
    fields,
    inverse: null,
    data: {
      key: t.key,
      created: true,
      checkpoints: checkpoints_added,
      sessions: s.added,
      links: t.links ?? 0
    }
  })
  return {
    task_id: id,
    activity_id,
    checkpoints_added,
    sessions_added: s.added,
    sessions_taken: s.taken,
    fields
  }
}

/** Atualiza só o que mudou. Nada mudou: `activity_id: null`, sem escrita e sem evento. */
export function importUpdateTaskIn(
  d: DomainDeps,
  emit: Emit,
  u: ImportTaskUpdate
): ImportWriteResult {
  const rec = liveTask(d.db, u.task_id)
  const set = u.set ?? {}
  const cps = cleanCheckpoints(u.checkpoints ?? [])
  const fresh = cps.filter((c) => !hasCheckpoint(d, rec.id, c))
  const lastNew = fresh.reduce<string | null>((m, c) => (m === null || c.at > m ? c.at : m), null)
  const current = rec.touched_at ?? rec.created_at
  const touched = lastNew !== null && lastNew > current ? lastNew : current

  const next: Record<string, string | null> = {}
  if (set.title !== undefined) next.title = cleanTitle(set.title)
  let description =
    set.description !== undefined ? cleanDescription(set.description) : rec.description
  if (u.append_links && u.append_links.length > 0)
    description = checkMax(
      'description',
      appendLinks(description, u.append_links),
      Limits.description
    )
  if (description !== rec.description) next.description = description

  if (set.stage !== undefined) {
    const reason = cleanReason(set.stage.blocked_reason)
    const stage = requireStage(d, rec.flow_id, set.stage.stage_id)
    next.stage_id = stage.id
    next.done_at = stage.is_final ? (rec.done_at ?? touched) : null
    next.blocked_reason = reason
    next.blocked_at =
      reason === null ? null : reason === rec.blocked_reason ? rec.blocked_at : touched
  }
  const moves = set.project_id !== undefined && set.project_id !== rec.project_id
  if (moves) {
    if (set.project_id !== null && !projectExists(d, set.project_id!))
      throw notFound('project', set.project_id!)
    next.project_id = set.project_id!
  }
  if (u.workdir !== undefined && u.workdir !== '' && !rec.workdir)
    next.workdir = cleanWorkdir(u.workdir)

  const columns = Object.keys(next).filter((k) => next[k] !== (rec as Record<string, unknown>)[k])
  const wrote = columns.length > 0
  if (wrote) {
    const sets = [...columns.map((k) => `${k} = @${k}`), 'touched_at = @touched']
    d.db
      .prepare(`update task set ${sets.join(', ')} where id = @id`)
      .run({ ...Object.fromEntries(columns.map((k) => [k, next[k]])), touched, id: rec.id })
  }
  if (moves) {
    d.db.prepare('delete from project_item where task_id = ?').run(rec.id)
    if (set.project_id !== null) appendProjectItem(d, set.project_id!, rec.id)
  }
  const checkpoints_added = insertCheckpoints(d, rec.id, fresh)
  if (!wrote && checkpoints_added > 0 && touched !== current)
    d.db.prepare('update task set touched_at = ? where id = ?').run(touched, rec.id)
  const s = syncSessions(d, rec.id, u.sessions ?? [])

  const changed = wrote || checkpoints_added > 0 || s.changed
  const result = {
    task_id: rec.id,
    checkpoints_added,
    sessions_added: s.added,
    sessions_taken: s.taken,
    fields: columns
  }
  if (!changed) return { ...result, activity_id: null }

  emit({ entity: 'task', ids: [rec.id], op: 'upsert' })
  emitCounters(emit, { project_id: moves ? set.project_id! : rec.project_id, flow_id: rec.flow_id })
  if (moves && rec.project_id !== null)
    emit({ entity: 'project', ids: [rec.project_id], op: 'upsert' })
  if (s.ids.length > 0) emit({ entity: 'session', ids: s.ids, op: 'upsert' })
  const activity_id = recordActivity(d, emit, ACTOR, {
    op: 'task_import',
    task_id: rec.id,
    fields: columns,
    inverse: null,
    data: {
      key: rec.key,
      created: false,
      checkpoints: checkpoints_added,
      sessions: s.added,
      links: u.links ?? u.append_links?.length ?? 0
    }
  })
  return { ...result, activity_id }
}

/** Projeto do import (`flow_id` NULL: o fluxo vem do tipo). Nome longo é do chamador resolver. */
export function importProjectIn(d: DomainDeps, emit: Emit, p: { name: string }): string {
  const name = p.name.trim()
  if (name === '') throw domainError('VALIDATION', 'name_required', { field: 'name' })
  checkMax('name', name, Limits.name)
  const id = d.newId()
  d.db.prepare('insert into project(id, name, flow_id) values (?, ?, null)').run(id, name)
  emit({ entity: 'project', ids: [id], op: 'upsert' })
  return id
}

const LINKS_HEADER = /^## Links[ \t]*$/m

/** Acrescenta linhas ao bloco `## Links` no fim da descrição, criando o cabeçalho se faltar. */
export function appendLinks(description: string | null, lines: string[]): string {
  if (lines.length === 0) return description ?? ''
  const block = lines.join('\n')
  const head = LINKS_HEADER.exec(description ?? '')
  if (head) {
    // entra dentro do bloco Links: antes da próxima seção, se houver
    const text = description as string
    const start = head.index + head[0].length
    const rest = text.slice(start)
    const next = rest.search(/^## /m)
    const links = (next < 0 ? rest : rest.slice(0, next)).replace(/\s+$/, '')
    const tail = next < 0 ? '' : `\n\n${rest.slice(next)}`
    return `${text.slice(0, start)}${links}\n${block}${tail}`
  }
  const body = (description ?? '').replace(/\s+$/, '')
  return body === '' ? `## Links\n\n${block}` : `${body}\n\n## Links\n\n${block}`
}

function cleanTitle(v: string): string {
  const t = v.trim()
  if (t === '') throw domainError('VALIDATION', 'title_required', { field: 'title' })
  return checkMax('title', t, Limits.title)
}

/** `''` vira NULL, como na criação pela tela. */
function cleanDescription(v: string | null): string | null {
  if (v === null || v === '') return null
  return checkMax('description', v, Limits.description)
}

/** `''`/`null` = sem pasta própria; senão absoluta (Decisão 20 do E3). */
function cleanWorkdir(v: string | null): string | null {
  if (v === null || v === '') return null
  checkMax('workdir', v, Limits.workdir)
  if (!isAbsolutePath(v)) throw domainError('VALIDATION', 'workdir_relative', { field: 'workdir' })
  return v
}

function cleanReason(v: string | null): string | null {
  if (v === null) return null
  const r = v.trim()
  return r === '' ? null : checkMax('blocked_reason', r, Limits.reason)
}

function cleanCheckpoints(list: ImportCheckpoint[]): ImportCheckpoint[] {
  return list.map((c) => {
    const text = c.text.trim()
    if (text === '') throw domainError('VALIDATION', 'text_required', { field: 'text' })
    return { at: c.at, text: checkMax('text', text, Limits.checkpoint) }
  })
}

function requireStage(d: DomainDeps, flowId: string, stageId: string): StageInfo {
  const s = d.db
    .prepare(
      'select id, is_final from flow_stage where id = ? and flow_id = ? and deleted_at is null'
    )
    .get(stageId, flowId) as StageInfo | undefined
  if (!s) throw domainError('VALIDATION', 'stage_not_in_flow', { stage_id: stageId })
  return s
}

const projectExists = (d: DomainDeps, id: string): boolean =>
  d.db.prepare('select 1 from project where id = ?').get(id) !== undefined

/** Key `T-<n>` importada sobe `key_seq` (Decisão 17); até 15 dígitos, como o `nextKey`. */
function bumpKeySeq(d: DomainDeps, key: string): void {
  const m = /^T-(\d{1,15})$/.exec(key)
  if (!m) return
  d.db
    .prepare(
      `insert into key_seq(prefix, last) values ('T', ?)
       on conflict(prefix) do update set last = max(last, excluded.last)`
    )
    .run(Number(m[1]))
}

/** Mesmo `(task, dia de at, hash do texto)`: o reimport não duplica. */
function hasCheckpoint(d: DomainDeps, taskId: string, c: ImportCheckpoint): boolean {
  return (
    d.db
      .prepare(
        'select 1 from checkpoint where task_id = ? and substr(at, 1, 10) = ? and text_hash = ?'
      )
      .get(taskId, c.at.slice(0, 10), checkpointHash(c.text)) !== undefined
  )
}

function insertCheckpoints(d: DomainDeps, taskId: string, list: ImportCheckpoint[]): number {
  const ins = d.db.prepare(
    `insert into checkpoint(id, task_id, at, text, source, text_hash)
     values (?, ?, ?, ?, 'import', ?)`
  )
  let n = 0
  for (const c of list) {
    if (hasCheckpoint(d, taskId, c)) continue
    ins.run(d.newId(), taskId, c.at, c.text, checkpointHash(c.text))
    n++
  }
  return n
}

type SessionSync = {
  added: number
  changed: boolean
  ids: string[]
  taken: { external_id: string; task_key: string }[]
}

/** Sessão por `(tool, external_id)` (Decisão 14): nasce encerrada; órfã é adotada; de outra task fica lá. */
function syncSessions(d: DomainDeps, taskId: string, list: ImportSession[]): SessionSync {
  const out: SessionSync = { added: 0, changed: false, ids: [], taken: [] }
  const find = d.db.prepare(
    `select s.id, s.task_id, s.label, t.key as task_key from ai_session s
     left join task t on t.id = s.task_id where s.tool = ? and s.external_id = ?`
  )
  for (const s of list) {
    const row = find.get(TOOL, s.external_id) as
      | { id: string; task_id: string | null; label: string | null; task_key: string | null }
      | undefined
    if (!row) {
      const id = d.newId()
      d.db
        .prepare(
          `insert into ai_session(id, task_id, tool, external_id, state, state_at, started_at, ended_at, label)
           values (?, ?, ?, ?, 'unknown', ?, ?, ?, ?)`
        )
        .run(id, taskId, TOOL, s.external_id, s.at, s.at, s.at, s.label)
      out.added++
      out.changed = true
      out.ids.push(id)
    } else if (row.task_id === taskId) {
      if (row.label !== s.label) {
        d.db.prepare('update ai_session set label = ? where id = ?').run(s.label, row.id)
        out.changed = true
        out.ids.push(row.id)
      }
    } else if (row.task_id === null) {
      d.db
        .prepare('update ai_session set task_id = ?, label = ? where id = ?')
        .run(taskId, s.label, row.id)
      out.added++
      out.changed = true
      out.ids.push(row.id)
    } else out.taken.push({ external_id: s.external_id, task_key: row.task_key ?? '' })
  }
  return out
}
