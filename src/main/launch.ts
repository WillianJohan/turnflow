import type { How, Plan, Task } from '../shared/types'
import { BRAND } from '../shared/brand'
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
