import { HL_CLOSE, HL_OPEN, type SearchHit } from '../../shared/ipc/search'
import { fold } from './fold'
import type { Db } from './open'

const MIN_TRIGRAM = 3

const phrase = (t: string): string => `"${t.replaceAll('"', '""')}"`
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, '\\$&')

/** Destaca `needle` (já dobrado) no título original; o dobrado pode ter outro tamanho, então mapeia por caractere. */
function highlight(title: string, needle: string): string {
  const chars = [...title]
  let folded = ''
  const start: number[] = [] // índice em `folded` -> índice em `chars`
  chars.forEach((c, i) => {
    const f = fold(c)
    for (let k = 0; k < f.length; k++) start.push(i)
    folded += f
  })
  const at = needle ? folded.indexOf(needle) : -1
  if (at < 0) return title
  const from = start[at]
  const to = start[at + needle.length - 1] + 1
  return (
    chars.slice(0, from).join('') +
    HL_OPEN +
    chars.slice(from, to).join('') +
    HL_CLOSE +
    chars.slice(to).join('')
  )
}

function viaFts(db: Db, terms: string[], limit: number): SearchHit[] {
  const rows = db
    .prepare(
      `select search_fts.kind as kind, search_fts.task_id as task_id, task.key as key,
              task.title as title, task.done_at is not null as done,
              snippet(search_fts, -1, ?, ?, '…', 12) as snippet
         from search_fts
         join task on task.id = search_fts.task_id and task.deleted_at is null
        where search_fts match ?
        order by bm25(search_fts)
        limit ?`
    )
    .all(HL_OPEN, HL_CLOSE, terms.map(phrase).join(' AND '), limit) as (Omit<SearchHit, 'done'> & {
    done: number
  })[]
  return rows.map((h) => ({ ...h, done: h.done === 1 }))
}

// Consulta curta (< 3 chars) não tem trigram: cai no LIKE por título e key.
function viaLike(db: Db, q: string, limit: number): SearchHit[] {
  const like = `%${likeEscape(q)}%`
  const rows = db
    .prepare(
      `select id as task_id, key, title, done_at from task
        where deleted_at is null
          and (tf_fold(title) like ? escape '\\' or tf_fold(key) like ? escape '\\')
        order by touched_at desc
        limit ?`
    )
    .all(like, like, limit) as {
    task_id: string
    key: string
    title: string
    done_at: string | null
  }[]
  return rows.map((r) => ({
    kind: 'task',
    task_id: r.task_id,
    key: r.key,
    title: r.title,
    done: r.done_at !== null,
    snippet: highlight(r.title, q)
  }))
}

export function runSearch(db: Db, q: string, limit = 30): SearchHit[] {
  // controles C0/DEL viram espaço: NUL quebra o SQL e \u0002/\u0003 forjariam o destaque
  const folded = fold(q)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
  if (!folded) return []
  const terms = folded.split(/\s+/).filter((t) => [...t].length >= MIN_TRIGRAM)
  return terms.length > 0 ? viaFts(db, terms, limit) : viaLike(db, folded, limit)
}
