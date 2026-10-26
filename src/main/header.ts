import { execFile } from 'child_process'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Header, HeaderCache, Task } from '../shared/types'
import { homedir } from 'os'
import { userDataDir } from './config'
import { loginEnv } from './loginEnv'
import { findSessionFile, transcriptTail } from './sessions'

export function buildPrompt(readme: string, tail: string): string {
  return `Você vai situar alguém que acabou de voltar pra esta task depois de horas fazendo outra coisa e não lembra nem do que ela se trata.

Responda com EXATAMENTE 3 linhas, nesta forma, nada antes nem depois:
O que é: <quem pediu, o que está quebrado ou falta, e por que importa — em português de gente, sem nome de função, classe ou arquivo>
Parei em: <o estado real agora>
Próximo: <UMA ação concreta>

Fale como colega de trabalho, direto, português do Brasil. Cada linha com no máximo 160 caracteres.

=== README da task ===
${readme}

=== Fim da última conversa (pode estar vazio) ===
${tail}`
}

const LABELS: [keyof Header, RegExp][] = [
  ['what', /^o que é:/i],
  ['where', /^parei em:/i],
  ['next', /^próximo:/i]
]

export function parseHeader(out: string): Header | null {
  const h: Partial<Header> = {}
  for (const raw of out.split('\n')) {
    const line = raw
      .replace(/\*\*/g, '')
      .replace(/^[-•\s]+/, '')
      .trim()
    for (const [k, re] of LABELS) if (re.test(line)) h[k] = line.replace(re, '').trim()
  }
  return h.what && h.where && h.next ? (h as Header) : null
}

// README mudou → regera. Conversa andou → só se o resumo tiver mais de 10 min
// (sessão viva muda o .jsonl a cada mensagem; sem isso cada troca de aba custava ~16s de Haiku).
const CONVERSA_TTL = 10 * 60_000
export const isStale = (
  c: HeaderCache | null,
  readmeMtime: number,
  jsonlMtime: number,
  now = Date.now()
): boolean =>
  !c ||
  c.readmeMtime !== readmeMtime ||
  (c.jsonlMtime !== jsonlMtime && now - (c.generatedAt ?? 0) > CONVERSA_TTL)

/** `cwd`: pasta onde o `claude -p` roda (a pasta padrão ou a home). */
type Opts = { cacheDir?: string; run?: (prompt: string) => Promise<string>; cwd?: string }

const cachePath = (dir: string, id: string): string => join(dir, `${id}.json`)

export async function readCache(
  task: Task,
  cacheDir = join(userDataDir(), 'headers')
): Promise<HeaderCache | null> {
  try {
    return JSON.parse(await readFile(cachePath(cacheDir, task.id), 'utf8'))
  } catch {
    return null
  }
}

// Sessão mais recente que ainda existe em disco (a mesma que o resume usaria).
async function latestSession(task: Task): Promise<string | null> {
  for (const s of [...task.sessions].reverse()) {
    const f = await findSessionFile(s.uuid)
    if (f) return f.path
  }
  return null
}

// Sem hooks globais (os de estilo deixariam o texto seco) e sem gravar sessão (não polui o /resume).
export const HEADER_ARGS = [
  '-p',
  '--model',
  'haiku',
  '--no-session-persistence',
  '--settings',
  '{"disableAllHooks":true}'
]

async function runClaude(prompt: string, cwd: string): Promise<string> {
  const { claude, PATH } = await loginEnv()
  return new Promise((res, rej) => {
    const p = execFile(
      claude,
      HEADER_ARGS,
      { cwd, timeout: 60000, env: { ...process.env, PATH }, maxBuffer: 1 << 20 },
      (err, stdout, stderr) =>
        err ? rej(new Error((stderr || err.message).trim().split('\n')[0])) : res(stdout)
    )
    p.stdin?.on('error', () => undefined) // claude saiu antes de ler tudo: o erro vem pelo callback
    p.stdin?.end(prompt)
  })
}

const inflight = new Map<string, Promise<HeaderCache | null>>()

export function getHeader(
  task: Task,
  force: boolean,
  opts: Opts = {}
): Promise<HeaderCache | null> {
  const running = inflight.get(task.id)
  if (running) return running
  const p = generate(task, force, opts).finally(() => inflight.delete(task.id))
  inflight.set(task.id, p)
  return p
}

async function generate(
  task: Task,
  force: boolean,
  {
    cacheDir = join(userDataDir(), 'headers'),
    cwd = homedir(),
    run = (p) => runClaude(p, cwd)
  }: Opts
): Promise<HeaderCache | null> {
  const old = await readCache(task, cacheDir)
  const readme = await readFile(task.readmePath, 'utf8').catch(() => '')
  const readmeMtime = (await stat(task.readmePath).catch(() => null))?.mtimeMs ?? 0
  const jsonl = await latestSession(task)
  const jsonlMtime = jsonl ? (await stat(jsonl)).mtimeMs : 0
  if (!force && !isStale(old, readmeMtime, jsonlMtime)) return old

  let next: HeaderCache
  try {
    const header = parseHeader(
      await run(buildPrompt(readme, jsonl ? await transcriptTail(jsonl) : ''))
    )
    if (!header) throw new Error('resposta fora do formato')
    next = { readmeMtime, jsonlMtime, generatedAt: Date.now(), header }
  } catch (e) {
    // mantém o cabeçalho anterior; mtimes zerados fazem tentar de novo na próxima abertura
    next = {
      readmeMtime: 0,
      jsonlMtime: 0,
      generatedAt: 0,
      header: old?.header ?? { what: '', where: '', next: '' },
      error: `não deu pra gerar o resumo: ${(e as Error).message}`
    }
  }
  await mkdir(cacheDir, { recursive: true })
  await writeFile(cachePath(cacheDir, task.id), JSON.stringify(next))
  return next
}
