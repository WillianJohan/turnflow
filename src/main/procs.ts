import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { SessionTool } from '../core/domain/session'

export type ProcLine = { pid: number; args: string[] }

/** Saída de `ps -axww -o pid=,args=`. Args separados por espaço. */
export function parsePs(out: string): ProcLine[] {
  const lines: ProcLine[] = []
  for (const line of out.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [pid, ...args] = trimmed.split(/\s+/)
    if (!/^\d+$/.test(pid)) continue
    lines.push({ pid: Number(pid), args })
  }
  return lines
}

/** Linhas `"<pid>\\t<CommandLine>"`. Aspas duplas agrupam um argumento. */
export function parseWinProcs(out: string): ProcLine[] {
  const lines: ProcLine[] = []
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const pid = line.slice(0, tab).trim()
    if (!/^\d+$/.test(pid)) continue
    lines.push({ pid: Number(pid), args: splitQuoted(line.slice(tab + 1)) })
  }
  return lines
}

function splitQuoted(command: string): string[] {
  const args: string[] = []
  let cur = ''
  let quote = false
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (ch === '"') {
      quote = !quote
      continue
    }
    if (ch === ' ' && !quote) {
      if (cur) args.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) args.push(cur)
  return args
}

const basename = (arg: string): string => {
  const name = arg.split(/[/\\]/).pop() ?? arg
  return name.replace(/\.(exe|cmd|bat)$/i, '')
}

// O claude do npm no Windows aparece como `node.exe …\@anthropic-ai\claude-code\cli.js` ou
// `cmd.exe /c "…\claude.cmd"`; o codex como `node.exe …\@openai\codex\bin\codex.js`.
const CLAUDE_JS = /[/\\]@anthropic-ai[/\\]claude-code[/\\]cli\.m?js$/i
const CODEX_JS = /[/\\]@openai[/\\]codex[/\\]bin[/\\]codex\.m?js$/i

const claudeMatch = (args: string[]): boolean =>
  args.some((a) => basename(a) === 'claude' || CLAUDE_JS.test(a))

export function binMatch(tool: SessionTool): (args: string[]) => boolean {
  if (tool === 'codex')
    return (args) => args.some((a) => basename(a) === 'codex' || CODEX_JS.test(a))
  return claudeMatch
}

// `cmd.exe /s /c ""…\claude.cmd" --resume U"`: as aspas do cmd juntam vários argumentos num
// item só. No Windows a busca olha também cada palavra, sem aspas.
const winTokens = (args: string[]): string[] =>
  args
    .flatMap((a) => [a, ...a.split(/\s+/)])
    .map((a) => a.replace(/"/g, ''))
    .filter(Boolean)

const PS_ARGS = ['-axww', '-o', 'pid=,args=']
const WIN_CMD =
  'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'

export async function findProcessByArg(
  arg: string,
  o: {
    ownPids: Set<number>
    platform: NodeJS.Platform
    match?: (args: string[]) => boolean
    procDir?: string
    exec?: (file: string, args: string[]) => Promise<string>
  }
): Promise<number | null> {
  const match = o.match ?? claudeMatch
  let lines: ProcLine[]
  try {
    if (o.platform === 'linux') {
      const dir = o.procDir ?? '/proc'
      lines = []
      for (const pid of await readdir(dir).catch(() => [] as string[])) {
        if (!/^\d+$/.test(pid)) continue
        const raw = await readFile(join(dir, pid, 'cmdline'), 'utf8').catch(() => '')
        lines.push({ pid: Number(pid), args: raw.split('\0').filter((a) => a.length > 0) })
      }
    } else if (o.platform === 'darwin') {
      lines = parsePs(await o.exec!('ps', PS_ARGS))
    } else if (o.platform === 'win32') {
      lines = parseWinProcs(await o.exec!('powershell', ['-NoProfile', '-Command', WIN_CMD]))
    } else return null
  } catch {
    return null
  }
  for (const line of lines) {
    if (o.ownPids.has(line.pid)) continue
    const args = o.platform === 'win32' ? winTokens(line.args) : line.args
    if (args.includes(arg) && match(args)) return line.pid
  }
  return null
}
