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

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/
// nomes que o Windows não aceita como arquivo/pasta, com ou sem extensão
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** Mesma leitura de cerca do parser; devolve o delimitador da cerca ainda aberta no fim, ou null. */
function openFence(lines: string[]): string | null {
  let open: string | null = null
  for (const t of lines) {
    if (open) {
      const c = FENCE_CLOSE.exec(t)?.[1]
      if (c && c[0] === open[0] && c.length >= open.length) open = null
    } else open = FENCE_OPEN.exec(t)?.[1] ?? null
  }
  return open
}

/** Fecha a cerca de código que ficou aberta, para ela não engolir o que vem depois no arquivo. */
const closeFences = (text: string): string => {
  const open = openFence(text.split('\n'))
  return open === null ? text : `${text}\n${open}`
}

const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim()

/** Nome de pasta seguro para a key: nunca vazio, nunca `.`/`..`, sem separador de caminho. */
export function safeDirName(key: string): string {
  let s = key.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, (m) => '_'.repeat(m.length))
  if (s === '') return '_'
  // ponto no fim some no Windows; nome reservado ganha `_`
  if (/[. ]$/.test(s) || WINDOWS_RESERVED.test(s)) s += '_'
  return s
}

function sessionLine(s: ExportTask['sessions'][number]): string {
  const who = s.external_id !== null && UUID.test(s.external_id) ? s.external_id : s.tool
  const label = s.label === null ? '' : ` — ${oneLine(s.label)}`
  return `- ${s.at} — ${who}${label}`
}

function checkpointItem(c: ExportTask['checkpoints'][number]): string {
  const lines = c.text.split('\n')
  // primeira linha que abre cerca não é vista pelo parser na linha do item: desce para a de baixo
  const inline = !FENCE_OPEN.test(lines[0]!)
  const [first, rest] = inline ? [lines[0]!, lines.slice(1)] : ['', lines]
  const body = closeFences(rest.join('\n'))
  const out = [first === '' ? `- ${c.at} —` : `- ${c.at} — ${first}`]
  // linhas dentro de cerca (e as próprias cercas) ficam como estão: o parser não tira o recuo delas
  let open: string | null = null
  for (const l of rest.length === 0 ? [] : body.split('\n')) {
    const was = open
    if (open) {
      const x = FENCE_CLOSE.exec(l)?.[1]
      if (x && x[0] === open[0] && x.length >= open.length) open = null
    } else open = FENCE_OPEN.exec(l)?.[1] ?? null
    out.push(was !== null || open !== null || l === '' ? l : `  ${l}`)
  }
  return out.join('\n')
}

export function renderReadme(t: ExportTask): string {
  const out: string[] = [`# ${t.key} — ${oneLine(t.title)}`, '', `Status: ${oneLine(t.stage)}`]
  if (t.blocked_reason !== null) out.push(`**Blocked:** ${oneLine(t.blocked_reason)}`)
  if (t.project !== null) out.push(`**Project:** ${oneLine(t.project)}`)
  out.push(`**Type:** ${oneLine(t.type)}`)
  if (t.workdir !== null) out.push(`**Workdir:** ${oneLine(t.workdir)}`)

  const desc = closeFences(t.description.trimEnd())
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
