import { createHash } from 'node:crypto'
import { fold } from '../../db/fold'
import type { Db } from '../../db/open'
import type { ParsedTask } from './parse'
import type { BrainDir } from './scan'

// Registro do import por key (Decisão 1) com o hash duplo de cada campo (Decisão 2): `md` = o que o
// markdown dizia no último import; `app` = o que o app tinha logo depois da última escrita do
// import naquele campo. "Mudou no md" e "editado no app" são comparações independentes.

export type ScalarField = 'title' | 'description' | 'project' | 'stage'
export const SCALAR_FIELDS: readonly ScalarField[] = ['title', 'description', 'project', 'stage']
export type FieldHash = { md: string; app: string }
/** `links` = URLs já importadas: o reimport só acrescenta as que faltam (Decisão 12). */
export type FieldHashes = Record<ScalarField, FieldHash> & { links: string[] }
export type ImportRecord = {
  source_key: string
  source_path: string
  task_id: string | null
  file_hash: string
  field_hashes: FieldHashes
  imported_at: string
}

export function sha(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

/**
 * Hashes vazios: nenhum valor tem sha `''`, então todo campo conta como mudado nos dois lados. É o
 * ponto de partida do `link` (key sem record) e o que sobra de um tombstone (`'{}'`, Decisão 16).
 */
export function emptyHashes(): FieldHashes {
  return {
    title: { md: '', app: '' },
    description: { md: '', app: '' },
    project: { md: '', app: '' },
    stage: { md: '', app: '' },
    links: []
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Lê o JSON tolerando campos ausentes (tombstone, versão antiga): o que falta vira vazio. */
function parseHashes(text: string): FieldHashes {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    raw = {}
  }
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out = emptyHashes()
  for (const f of SCALAR_FIELDS) {
    const h = (o[f] ?? {}) as Record<string, unknown>
    out[f] = { md: str(h.md), app: str(h.app) }
  }
  out.links = Array.isArray(o.links) ? o.links.filter((u) => typeof u === 'string') : []
  return out
}

type RecordRow = Omit<ImportRecord, 'field_hashes'> & { field_hashes: string }

/** Leitor com o statement preparado uma vez (o plano lê um record por task). */
export function recordReader(db: Db): (sourceKey: string) => ImportRecord | null {
  const stmt = db.prepare('select * from import_record where source_key = ?')
  return (sourceKey) => {
    const r = stmt.get(sourceKey) as RecordRow | undefined
    return r ? { ...r, field_hashes: parseHashes(r.field_hashes) } : null
  }
}

export function readRecord(db: Db, sourceKey: string): ImportRecord | null {
  return recordReader(db)(sourceKey)
}

/** Upsert pela key. Sem `tx` própria: quem chama já está numa. */
export function writeRecordIn(db: Db, r: ImportRecord): void {
  db.prepare(
    `insert into import_record(source_key, source_path, task_id, file_hash, field_hashes, imported_at)
     values (@source_key, @source_path, @task_id, @file_hash, @field_hashes, @imported_at)
     on conflict(source_key) do update set
       source_path = excluded.source_path, task_id = excluded.task_id,
       file_hash = excluded.file_hash, field_hashes = excluded.field_hashes,
       imported_at = excluded.imported_at`
  ).run({ ...r, field_hashes: JSON.stringify(r.field_hashes) })
}

/** Chave do projeto do import: `key:<KEY>` (Pai) ou `name:<sha256(fold)>` (`**Project:**`). */
export function projectSourceKey(p: Pick<ParsedTask, 'parent' | 'project_name'>): string {
  if (p.parent) return `key:${p.parent.toUpperCase()}`
  const name = p.project_name?.trim()
  return name ? `name:${sha(fold(name))}` : ''
}

/** Valor de cada campo como o markdown diz (entrada do hash `md`). */
export function mdValues(p: ParsedTask, dir: BrainDir): Record<ScalarField, string> {
  return {
    title: p.title,
    description: p.description,
    project: projectSourceKey(p),
    stage: `${dir}|${p.status ?? ''}|${p.blocked ?? ''}`
  }
}

/** Valor de cada campo como o app guarda (entrada do hash `app`). */
export function appValues(db: Db, taskId: string): Record<ScalarField, string> {
  const t = db
    .prepare(
      'select title, description, project_id, stage_id, blocked_reason from task where id = ?'
    )
    .get(taskId) as
    | {
        title: string
        description: string | null
        project_id: string | null
        stage_id: string
        blocked_reason: string | null
      }
    | undefined
  if (!t) throw new Error(`task ${taskId} inexistente`)
  return appValuesOf(t)
}

/** O mesmo formato do `appValues` para um valor que o app ainda vai ter. */
export function appValuesOf(t: {
  title: string
  description: string | null
  project_id: string | null
  stage_id: string
  blocked_reason: string | null
}): Record<ScalarField, string> {
  return {
    title: t.title,
    description: t.description ?? '',
    project: t.project_id ?? '',
    stage: `${t.stage_id}|${t.blocked_reason ?? ''}`
  }
}
