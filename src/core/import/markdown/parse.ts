import { fold } from '../../db/fold'

/** Task lida de um README no formato do brain, pronta para o plano de import. Sem E/S. */
export type ParsedTask = {
  key: string
  title: string
  status: string | null
  parent: string | null
  project_name: string | null
  type_name: string | null
  blocked: string | null
  description: string
  links: { line: string; url: string }[]
  sessions: { at: string; external_id: string; label: string | null }[]
  checkpoints: { at: string; text: string }[]
  workdir_hint: string | null
}

type Line = { t: string; fenced: boolean }

const DATE_SRC =
  '\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?'
const DATE_PARTS =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
// [1] ** de abertura, [2] data, [3] ** depois da data, [4] ** depois do qualificador, [5] ** depois do separador, [6] texto
const CHECKPOINT_HEAD = new RegExp(
  `^(\\*\\*)?(${DATE_SRC})(\\*\\*)?(?:\\s*\\([^)]*\\))?(\\*\\*)?(?:\\s*[:—–]|\\s+-(?=\\s))(\\*\\*)?\\s*(.*)$`
)
const SESSION_HEAD = new RegExp(`^(?:\\*\\*)?(${DATE_SRC})`)
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const META =
  /^\*{0,2}(Status|Pai|Parent|Project|Type|Blocked|Workdir|Worktree|Branch)\*{0,2}:\*{0,2}\s*(.*)$/i
const ITEM = /^[-*+]\s+(.*)$/
const H2 = /^##\s+(.*)$/
const H3_PLUS = /^#{3,}\s+(.*)$/
const FENCE = /^\s*(```|~~~)/

const calendarOk = (y: number, mo: number, d: number): boolean => {
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

/**
 * Data do markdown em ISO UTC (Decisão 5). `YYYY-MM-DD` sozinho: meio-dia UTC mais `index` segundos
 * (mantém a ordem do arquivo); com `Z`/offset: exata; `YYYY-MM-DD HH:MM` sem zona: hora local.
 * Inválida: `null`.
 */
export function parseDate(s: string, index: number): string | null {
  const m = DATE_PARTS.exec(s.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (!calendarOk(y, mo, d)) return null
  if (m[4] === undefined) return new Date(Date.UTC(y, mo - 1, d, 12, 0, index)).toISOString()
  const [h, mi, sec] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)]
  const ms = Number((m[7] ?? '0').padEnd(3, '0'))
  if (h > 23 || mi > 59 || sec > 59) return null
  const zone = m[8]
  let t: Date
  if (zone === undefined) {
    t = new Date(y, mo - 1, d, h, mi, sec, ms)
  } else if (zone === 'Z') {
    t = new Date(Date.UTC(y, mo - 1, d, h, mi, sec, ms))
  } else {
    const digits = zone.slice(1).replace(':', '')
    const [oh, om] = [Number(digits.slice(0, 2)), Number(digits.slice(2))]
    if (oh > 23 || om > 59) return null
    const offset = (oh * 60 + om) * (zone[0] === '-' ? -1 : 1)
    t = new Date(Date.UTC(y, mo - 1, d, h, mi, sec, ms) - offset * 60_000)
  }
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

/** Texto que sobrou de uma seção estruturada: vai para a descrição sob o cabeçalho original. */
class Leftover {
  private lines: string[] = []
  add(t: string): void {
    if (t.trim() === '') {
      if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== '') this.lines.push('')
      return
    }
    this.lines.push(t)
  }
  piece(heading: string): string | null {
    const body = trimBlank(this.lines)
    return body.length === 0 ? null : [heading, ...body].join('\n')
  }
}

function trimBlank(lines: string[]): string[] {
  let a = 0
  let b = lines.length
  while (a < b && lines[a]!.trim() === '') a++
  while (b > a && lines[b - 1]!.trim() === '') b--
  return lines.slice(a, b)
}

const stripIndent = (t: string): string => t.replace(/^(?: {1,2}|\t)/, '')

function firstUrl(line: string): string | null {
  const m = /https?:\/\/[^\s<>)\]]+/.exec(line)
  return m ? m[0].replace(/[.,;:!?'"]+$/, '') : null
}

function parseSession(content: string, index: number): ParsedTask['sessions'][number] | null {
  const head = SESSION_HEAD.exec(content)
  const id = UUID.exec(content)
  if (!head || !id) return null
  const at = parseDate(head[1]!, index)
  if (at === null) return null
  const after = content.slice(id.index + id[0].length)
  const label = after.replace(/^[\s`"')\]*—–:-]+/, '').trim()
  return { at, external_id: id[0].toLowerCase(), label: label === '' ? null : label }
}

function parseCheckpointItem(content: string, index: number): { at: string; text: string } | null {
  const m = CHECKPOINT_HEAD.exec(content)
  if (!m) return null
  const at = parseDate(m[2]!, index)
  if (at === null) return null
  // `**data:** texto`: o ** depois do separador fecha o negrito aberto na data; senão é do texto.
  const closesBold = m[1] !== undefined && m[3] === undefined && m[4] === undefined
  const text = (m[5] !== undefined && !closesBold ? m[5] : '') + m[6]!
  return { at, text }
}

type Open = { at: string; lines: string[]; heading: boolean }

function parseCheckpoints(lines: Line[], out: ParsedTask['checkpoints'], left: Leftover): void {
  let cur: Open | null = null
  const close = (): void => {
    if (!cur) return
    const [first = '', ...rest] = cur.lines
    // `###`: o título e o corpo (sem a linha em branco entre os dois)
    const text = cur.heading
      ? [first, ...trimBlank(rest)].join('\n').trim()
      : trimBlank(cur.lines).join('\n').trim()
    if (text === '') {
      for (const l of cur.lines) left.add(l)
    } else {
      out.push({ at: cur.at, text })
    }
    cur = null
  }
  for (const { t, fenced } of lines) {
    const h = fenced ? null : H3_PLUS.exec(t)
    if (h) {
      close()
      const dm = new RegExp(`^(${DATE_SRC})\\s*(?:[:—–]|-(?=\\s)|$)\\s*(.*)$`).exec(
        h[1]!.replace(/^\*\*(.*?)\*\*/, '$1')
      )
      const at = dm ? parseDate(dm[1]!, out.length) : null
      if (dm && at !== null) cur = { at, lines: [dm[2]!], heading: true }
      else left.add(t)
      continue
    }
    const item = fenced || cur?.heading ? null : ITEM.exec(t)
    if (item) {
      close()
      const cp = parseCheckpointItem(item[1]!, out.length)
      if (cp) cur = { at: cp.at, lines: [cp.text], heading: false }
      else left.add(t)
      continue
    }
    if (cur) cur.lines.push(cur.heading ? t : stripIndent(t))
    else left.add(t)
  }
  close()
}

/** Lê o README de uma task do brain. Tudo que não vira campo estruturado vai para a descrição. */
export function parseTaskReadme(text: string, key: string): ParsedTask {
  const raw = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
  let fence = false
  const lines: Line[] = raw.map((t) => {
    const isFence = FENCE.test(t)
    const fenced = fence || isFence
    if (isFence) fence = !fence
    return { t, fenced }
  })

  const task: ParsedTask = {
    key,
    title: key,
    status: null,
    parent: null,
    project_name: null,
    type_name: null,
    blocked: null,
    description: '',
    links: [],
    sessions: [],
    checkpoints: [],
    workdir_hint: null
  }

  const firstSection = lines.findIndex((l) => !l.fenced && H2.test(l.t))
  const headEnd = firstSection === -1 ? lines.length : firstSection
  const pieces: string[] = []

  const head: string[] = []
  let h1Done = false
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[—–-]\\s*(.+)$`, 'i')
  const set = (field: keyof ParsedTask, v: string | null): boolean => {
    if (v === null || task[field] !== null) return false
    ;(task as Record<string, unknown>)[field] = v
    return true
  }
  for (const { t, fenced } of lines.slice(0, headEnd)) {
    if (!fenced) {
      const h1 = h1Done ? null : /^#\s+(.+?)\s*$/.exec(t)
      if (h1) {
        h1Done = true
        task.title = keyRe.exec(h1[1]!)?.[1]!.trim() ?? h1[1]!
        continue
      }
      const meta = META.exec(t)
      if (meta) {
        const v = meta[2]!.trim()
        const name = meta[1]!.toLowerCase()
        let used: boolean
        if (name === 'status') used = set('status', v === '' ? null : v)
        else if (name === 'pai' || name === 'parent')
          used = set('parent', /[A-Za-z][A-Za-z0-9]*-\d+/.exec(v)?.[0] ?? null)
        else if (name === 'project') used = set('project_name', v === '' ? null : v)
        else if (name === 'type') used = set('type_name', v === '' ? null : v)
        else if (name === 'blocked') used = set('blocked', v === '' ? null : v)
        else {
          // workdir/worktree/branch: a linha sai da descrição, o path vira dica
          task.workdir_hint ??= /(?:^|[\s`'"(])(\/[^\s`'")]+)/.exec(v)?.[1] ?? null
          used = true
        }
        if (used) continue
      }
    }
    head.push(t)
  }
  const headText = trimBlank(head).join('\n')
  if (headText !== '') pieces.push(headText)

  // seções `## `
  type Section = { heading: string; title: string; body: Line[] }
  const sections: Section[] = []
  if (firstSection !== -1) {
    for (const l of lines.slice(firstSection)) {
      const h = l.fenced ? null : H2.exec(l.t)
      if (h) sections.push({ heading: l.t, title: fold(h[1]!.trim()), body: [] })
      else sections[sections.length - 1]!.body.push(l)
    }
  }
  for (const s of sections) {
    const isSessions = s.title.startsWith('sess')
    const isCheckpoints = s.title.startsWith('checkpoint')
    const isLinks = s.title === 'mrs' || s.title === 'links'
    if (!isSessions && !isCheckpoints && !isLinks) {
      pieces.push(trimBlank([s.heading, ...s.body.map((l) => l.t)]).join('\n'))
      continue
    }
    const left = new Leftover()
    if (isCheckpoints) {
      parseCheckpoints(s.body, task.checkpoints, left)
    } else {
      for (const { t, fenced } of s.body) {
        if (isLinks) {
          const url = fenced ? null : firstUrl(t)
          if (url) task.links.push({ line: t.trim(), url })
          else left.add(t)
        } else {
          const item = fenced ? null : ITEM.exec(t)
          const session = item ? parseSession(item[1]!, task.sessions.length) : null
          if (session) task.sessions.push(session)
          else left.add(t)
        }
      }
    }
    const piece = left.piece(s.heading)
    if (piece !== null) pieces.push(piece)
  }

  task.description = pieces.join('\n\n').trim()
  return task
}
