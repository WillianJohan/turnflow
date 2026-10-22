// Renderização do README de uma task no formato do brain (Decisão 23). Sem E/S: o parser do import
// (`import/markdown/parse.ts`) lê de volta o que sai daqui.

export type ExportTask = {
  key: string
  title: string
  stage: string
  blocked_reason: string | null
  project: string | null
  type: string
  workdir: string | null
  description: string
  sum: { what: string | null; where: string | null; next: string | null }
  checkpoints: { at: string; text: string }[]
  sessions: { at: string; external_id: string | null; tool: string; label: string | null }[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// as mesmas linhas de metadado que o parser consome (parse.ts, META)
const META_LINE =
  /^\*{0,2}(Status|Pai|Parent|Project|Type|Blocked|Workdir|Worktree|Branch)\*{0,2}:\*{0,2}/im

const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim()

/** Nome de pasta seguro para a key: nunca vazio, nunca `.`/`..`, sem separador de caminho. */
export function safeDirName(key: string): string {
  const s = key.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, (m) => '_'.repeat(m.length))
  return s === '' ? '_' : s
}

function sessionLine(s: ExportTask['sessions'][number]): string {
  const day = s.at.slice(0, 10)
  const who = s.external_id !== null && UUID.test(s.external_id) ? s.external_id : s.tool
  const label = s.label === null ? '' : ` — ${oneLine(s.label)}`
  return `- ${day} — ${who}${label}`
}

function checkpointItem(c: ExportTask['checkpoints'][number]): string {
  const [first = '', ...rest] = c.text.split('\n')
  return [`- ${c.at} — ${first}`, ...rest.map((l) => (l === '' ? '' : `  ${l}`))].join('\n')
}

export function renderReadme(t: ExportTask): string {
  const out: string[] = [`# ${t.key} — ${oneLine(t.title)}`, '', `Status: ${oneLine(t.stage)}`]
  if (t.blocked_reason !== null) out.push(`**Blocked:** ${oneLine(t.blocked_reason)}`)
  if (t.project !== null) out.push(`**Project:** ${oneLine(t.project)}`)
  out.push(`**Type:** ${oneLine(t.type)}`)
  if (t.workdir !== null) out.push(`**Workdir:** ${oneLine(t.workdir)}`)

  const desc = t.description.trimEnd()
  if (desc.trim() !== '') {
    // Crua logo depois dos metadados. Se ela tem linha que o parser leria como metadado, vai numa
    // seção `## Description`, que o parser devolve sem o cabeçalho e sem reler os metadados.
    if (META_LINE.test(desc)) out.push('', '## Description', '', desc)
    else out.push('', desc)
  }

  const { what, where, next } = t.sum
  if (what !== null || where !== null || next !== null) {
    out.push('', '## Summary', '')
    if (what !== null) out.push(`- What: ${oneLine(what)}`)
    if (where !== null) out.push(`- Where: ${oneLine(where)}`)
    if (next !== null) out.push(`- Next: ${oneLine(next)}`)
  }
  if (t.sessions.length > 0) out.push('', '## Sessions', '', ...t.sessions.map(sessionLine))
  if (t.checkpoints.length > 0)
    out.push('', '## Checkpoints', '', ...t.checkpoints.map(checkpointItem))
  return out.join('\n') + '\n'
}
