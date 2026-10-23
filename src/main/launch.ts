import type { How, Plan, Task } from '../shared/types'
import { BRAND } from '../shared/brand'
import { SESSION_COPY } from '../shared/copy/session'
import { sessionError, type SessionTool } from '../core/domain/session'
type Deps = {
  find: (uuid: string) => Promise<{ path: string; cwd: string } | null>
  elsewhere: (uuid: string) => Promise<number | null>
  cwdExists?: (dir: string) => Promise<boolean>
  inApp?: (uuid: string) => string | null
}

// Outra aba do próprio app já está com esse uuid (épico e filha gravam a mesma conversa).
export function inUseBy(uuid: string, owners: Map<string, string>, self: string): string | null {
  for (const [id, u] of owners) if (u === uuid && id !== self) return id
  return null
}

export async function resolveLaunch(task: Task, deps: Deps, uuid?: string): Promise<Plan> {
  const uuids = uuid ? [uuid] : task.sessions.map((s) => s.uuid).reverse()
  if (!uuids.length) return { kind: 'none' }
  for (const u of uuids) {
    const f = await deps.find(u)
    if (!f) continue
    const by = deps.inApp?.(u)
    if (by) return { kind: 'elsewhere', uuid: u, pid: 0, by }
    const pid = await deps.elsewhere(u)
    if (pid) return { kind: 'elsewhere', uuid: u, pid }
    // worktree apagado depois do merge: o chdir do PTY falharia
    if (f.cwd && deps.cwdExists && !(await deps.cwdExists(f.cwd)))
      return { kind: 'gone', uuid: u, cwd: f.cwd }
    return { kind: 'resume', uuid: u, cwd: f.cwd }
  }
  return { kind: 'missing', uuids: task.sessions.map((s) => s.uuid) }
}

// Mesmo texto do _dk_new_session (.aliases.sh:358-371).
export const newSessionPrompt = (task: Task): string => `Vamos trabalhar na task ${task.id}.

Lê o README inteiro primeiro: ${task.readmePath}

Grava o UUID desta sessão na seção '## Sessões' desse README antes de tocar em
código — formato: - <data ISO> — <uuid> — <o que foi feito>.

Depois me situa em 3-5 linhas: status, último checkpoint, critérios de aceite que
faltam, worktree.`

export function claudeArgv(task: Task, settingsPath: string, how: How): string[] {
  const first = 'resume' in how ? ['--resume', how.resume] : [newSessionPrompt(task)]
  return ['claude', ...first, '--name', `${task.id} ${task.title}`, '--settings', settingsPath]
}

// Env do PTY: herda o do app menos os marcadores de uma sessão claude pai
// (com eles o claude filho desliga o transcript e a conversa não é salva), o
// ELECTRON_RUN_AS_NODE (herdado, faria o `turnflow mcp` do shim rodar como node puro) e as
// variáveis de sessão do próprio app (um app aberto de dentro de uma sessão não as repassa).
const SESSION_VARS = ['SESSION_TOKEN', 'HOOK_PORT', 'TASK', 'TOKEN', 'PORT'].map(
  (k) => `${BRAND.envPrefix}${k}`
)
const stripped = (k: string): boolean =>
  k === 'ELECTRON_RUN_AS_NODE' || /^CLAUDE(CODE$|_CODE_)/.test(k) || SESSION_VARS.includes(k)

export function ptyEnv(
  base: Record<string, string | undefined>,
  extra: Record<string, string>
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !stripped(k)) env[k] = v
  return { ...env, TERM: 'xterm-256color', ...extra }
}

export type LaunchTask = {
  key: string
  title: string
  description: string
  workdir: string | null
  first_session: boolean
}

/** Scratch (`null`) usa a pasta padrão ou a home. Task sem as duas pede a pasta. */
export function launchDir(
  task: { workdir: string | null } | null,
  defaultWorkdir: string | null,
  home: string
): { dir: string } | { ask: true } {
  if (!task) return { dir: defaultWorkdir ?? home }
  const dir = task.workdir ?? defaultWorkdir
  return dir ? { dir } : { ask: true }
}

export const PROMPT_DESCRIPTION_MAX = 4_000

export function initialPrompt(t: LaunchTask): string {
  let text = SESSION_COPY.initialPrompt(t.key, t.title, BRAND.id)
  const description = t.description.trim()
  if (t.first_session && description) {
    const cut = description.length > PROMPT_DESCRIPTION_MAX
    text +=
      SESSION_COPY.descriptionIntro +
      (cut ? description.slice(0, PROMPT_DESCRIPTION_MAX) : description)
    if (cut) text += SESSION_COPY.descriptionCut
  }
  return text
}

/** Quebra por espaço, sem shell e sem itens vazios. */
export function splitCommand(s: string): string[] {
  return s.split(' ').filter((part) => part.length > 0)
}

export type AgentCommands = {
  claude: string
  codex: string[]
  cursor: string[]
  other: string[] | null
}

export function agentArgv(i: {
  tool: SessionTool
  bin: AgentCommands
  task: LaunchTask | null
  resume: string | null
  settingsPath: string
}): string[] {
  const prompt = i.task ? initialPrompt(i.task) : ''
  const name = i.task ? `${i.task.key} ${i.task.title}` : null
  if (i.tool === 'claude-code') {
    if (i.resume) {
      const argv = [i.bin.claude, '--resume', i.resume, '--settings', i.settingsPath]
      if (name) argv.push('--name', name)
      return argv
    }
    if (i.task && name) return [i.bin.claude, prompt, '--name', name, '--settings', i.settingsPath]
    return [i.bin.claude, '--settings', i.settingsPath]
  }
  if (i.tool === 'codex') {
    if (i.resume) return [...i.bin.codex, 'resume', i.resume]
    if (i.task) return [...i.bin.codex, prompt]
    return [...i.bin.codex]
  }
  if (i.tool === 'cursor') {
    if (i.resume) throw sessionError('VALIDATION', 'not_resumable')
    if (i.task) return [...i.bin.cursor, prompt]
    return [...i.bin.cursor]
  }
  if (!i.bin.other) throw sessionError('VALIDATION', 'agent_not_configured')
  if (i.resume) throw sessionError('VALIDATION', 'not_resumable')
  return [...i.bin.other]
}

export function shellArgv(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>
): string[] {
  if (platform === 'win32') return [env.ComSpec || 'cmd.exe']
  return [env.SHELL || '/bin/bash', '-i']
}

const envKey = (name: string): string => `${BRAND.envPrefix}${name}`

export function sessionEnv(i: {
  path: string
  token: string
  port: number
  socket: string
  taskKey: string | null
}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: i.path,
    [envKey('SESSION_TOKEN')]: i.token,
    [envKey('HOOK_PORT')]: String(i.port),
    [envKey('SOCKET')]: i.socket
  }
  if (i.taskKey) env[envKey('TASK')] = i.taskKey
  return env
}
