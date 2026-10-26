import { BRAND } from '../shared/brand'
import { CONFIG_COPY } from '../shared/copy/config'
import { SESSION_COPY } from '../shared/copy/session'
import { sessionError, type SessionTool } from '../core/domain/session'
import { IpcError } from './ipc/handle'

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
  extra: Record<string, string>,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  // no Windows o nome da variável não diferencia caixa: `Path` herdado + `PATH` do app viraria
  // duas chaves e o filho pegaria qualquer uma. A do `extra` substitui a herdada.
  const win = platform === 'win32'
  const overridden = new Set(Object.keys(extra).map((k) => k.toUpperCase()))
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base))
    if (v !== undefined && !stripped(k) && !(win && overridden.has(k.toUpperCase()))) env[k] = v
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
  /** `null`: claude não instalado; só o claude-code precisa dele. */
  claude: string | null
  codex: string[]
  cursor: string[]
  other: string[] | null
}

// No Windows um .cmd/.bat roda dentro do cmd.exe, que reinterpreta a linha de comando (%VAR%,
// &, |, ^, aspas): texto livre no argv vira comando (BatBadBut). Para eles o prompt leva só a
// key, o --name só a key, e qualquer argumento com metacaractere do cmd é recusado.
const isBatch = (bin: string | undefined): boolean => !!bin && /\.(cmd|bat)$/i.test(bin)
const CMD_META = /[%^&|<>"!\r\n]/

function batchSafe(argv: string[]): string[] {
  if (isBatch(argv[0]) && argv.slice(1).some((a) => CMD_META.test(a)))
    throw sessionError('VALIDATION', 'unsafe_batch_arg')
  return argv
}

export function agentArgv(i: {
  tool: SessionTool
  bin: AgentCommands
  task: LaunchTask | null
  resume: string | null
  settingsPath: string
}): string[] {
  const t = i.task
  const prompt = (bin: string | undefined): string =>
    !t ? '' : isBatch(bin) ? SESSION_COPY.initialPromptBatch(t.key, BRAND.id) : initialPrompt(t)
  const name = (bin: string): string | null =>
    !t ? null : isBatch(bin) ? t.key : `${t.key} ${t.title}`
  if (i.tool === 'claude-code') {
    const claude = i.bin.claude
    if (!claude) throw new IpcError('NOT_FOUND', CONFIG_COPY.claudeNotFound)
    const label = name(claude)
    if (i.resume) {
      const argv = [claude, '--resume', i.resume, '--settings', i.settingsPath]
      if (label) argv.push('--name', label)
      return batchSafe(argv)
    }
    if (t && label)
      return batchSafe([claude, prompt(claude), '--name', label, '--settings', i.settingsPath])
    return batchSafe([claude, '--settings', i.settingsPath])
  }
  if (i.tool === 'codex') {
    const bin = i.bin.codex
    // `codex resume <id>`: só chega aqui com o external_id do E7 (o host recusa sem ele)
    if (i.resume) return batchSafe([...bin, 'resume', i.resume])
    if (t) return batchSafe([...bin, prompt(bin[0])])
    return batchSafe([...bin])
  }
  if (i.tool === 'cursor') {
    const bin = i.bin.cursor
    if (i.resume) throw sessionError('VALIDATION', 'not_resumable')
    if (t) return batchSafe([...bin, prompt(bin[0])])
    return batchSafe([...bin])
  }
  if (!i.bin.other) throw sessionError('VALIDATION', 'agent_not_configured')
  if (i.resume) throw sessionError('VALIDATION', 'not_resumable')
  return batchSafe([...i.bin.other])
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
