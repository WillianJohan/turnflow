import type { ImportReport } from '../../../shared/contracts'
import { nowIso, type DomainDeps, type Emit } from '../../domain/context'
import {
  importCreateTaskIn,
  importProjectIn,
  importUpdateTaskIn,
  type ImportWriteResult
} from '../../domain/importTask'
import { importError } from '../errors'
import type { ImportPlan, ProjectRef } from './plan'
import { sha, writeRecordIn, type FieldHashes } from './record'

// Apply do import (E4): executa o plano numa transação só. Qualquer erro no meio desfaz tudo e
// nenhum `domain.changed` sai (o `tx` só emite depois do commit). A origem nunca é tocada: o apply
// só recebe o plano, que já é dado em memória.

export type ApplyHooks = { afterTask?: (key: string) => void }

/**
 * Lê o plano DENTRO da transação (`plan` é só leitura: não abre `tx` nem chama função pública) e
 * compara o `token` antes de qualquer escrita: se não é mais o da prévia que o usuário viu,
 * `CONFLICT preview_stale` sem escrever nada. `none` não escreve (Decisão 32); `create`/`update`
 * gravam a task e o record.
 */
export function applyImport(
  d: DomainDeps,
  plan: () => ImportPlan,
  expectedToken: string,
  hooks: ApplyHooks = {}
): ImportReport {
  return d.tx((emit) => {
    const p = plan()
    if (p.preview.token !== expectedToken) throw importError('CONFLICT', 'preview_stale')
    const rows = new Map(p.preview.tasks.map((r) => [r.key, r]))
    const report = emptyReport(p)
    const now = nowIso(d)
    const projects = resolveProjects(d, emit, p.projects, now, report)
    const projectId = (ref: ProjectRef | null): string | null =>
      ref === null ? null : (projects.get(ref.source_key) ?? null)

    for (const t of p.tasks) {
      const links = rows.get(t.key)?.new_links ?? 0
      if (t.kind === 'create') {
        const project_id = projectId(t.project)
        const r = importCreateTaskIn(d, emit, { ...t.create, project_id, links })
        writeRecordIn(d.db, {
          ...t.record,
          task_id: r.task_id,
          field_hashes: withProject(t.record.field_hashes, t.project, project_id),
          imported_at: now
        })
        count(report, r, links)
      } else if (t.kind === 'update') {
        const project_id = t.project === undefined ? undefined : projectId(t.project)
        const set = project_id === undefined ? t.update.set : { ...t.update.set, project_id }
        const r = importUpdateTaskIn(d, emit, {
          ...t.update,
          task_id: t.task_id,
          links,
          ...(set ? { set } : {})
        })
        writeRecordIn(d.db, {
          ...t.record,
          field_hashes: withProject(t.record.field_hashes, t.project, project_id),
          imported_at: now
        })
        count(report, r, links)
        for (const field of t.taken ?? []) report.taken_markdown.push({ key: t.key, field })
      }
      hooks.afterTask?.(t.key)
    }
    return report
  })
}

/**
 * Projetos antes das tasks: `import_project` com projeto vivo é reusado; com `project_id` NULL (ou
 * projeto que sumiu) foi apagado no app e não volta (a task fica sem projeto); sem linha, nasce.
 */
function resolveProjects(
  d: DomainDeps,
  emit: Emit,
  refs: ProjectRef[],
  now: string,
  report: ImportReport
): Map<string, string | null> {
  const find = d.db.prepare(
    `select ip.project_id, p.id as live from import_project ip
     left join project p on p.id = ip.project_id where ip.source_key = ?`
  )
  const link = d.db.prepare(
    'insert into import_project(source_key, project_id, imported_at) values (?, ?, ?)'
  )
  const out = new Map<string, string | null>()
  for (const ref of refs) {
    const r = find.get(ref.source_key) as
      { project_id: string | null; live: string | null } | undefined
    if (r) {
      out.set(ref.source_key, r.live)
      continue
    }
    const id = importProjectIn(d, emit, { name: ref.name })
    link.run(ref.source_key, id, now)
    report.projects_created++
    out.set(ref.source_key, id)
  }
  return out
}

/** O plano não conhece o id do projeto que nasce aqui: o `app` do hash passa a ser ele. */
function withProject(
  h: FieldHashes,
  ref: ProjectRef | null | undefined,
  projectId: string | null | undefined
): FieldHashes {
  if (!ref) return h
  return { ...h, project: { ...h.project, app: sha(projectId ?? '') } }
}

function count(report: ImportReport, r: ImportWriteResult, links: number): void {
  report.checkpoints_added += r.checkpoints_added
  report.sessions_added += r.sessions_added
  report.sessions_taken.push(...r.sessions_taken)
  report.links_added += links
}

/** Contagens por ação vêm da prévia (é o que o usuário aprovou); o resto o apply soma. */
function emptyReport(plan: ImportPlan): ImportReport {
  const rows = plan.preview.tasks
  const n = (a: string): number => rows.filter((r) => r.action === a).length
  return {
    created: n('create'),
    updated: n('update'),
    linked: n('link'),
    record_only: n('record_only'),
    unchanged: n('unchanged'),
    deleted_in_app: rows.filter((r) => r.action === 'deleted_in_app').map((r) => r.key),
    invalid: rows
      .filter((r) => r.action === 'invalid')
      .map((r) => ({ key: r.key, reason: r.reason ?? '' })),
    conflicts_kept: rows.flatMap((r) => r.conflicts.map((c) => ({ key: c.key, field: c.field }))),
    taken_markdown: [],
    checkpoints_added: 0,
    sessions_added: 0,
    sessions_taken: [],
    links_added: 0,
    projects_created: 0,
    ignored: plan.preview.ignored,
    warnings: []
  }
}
