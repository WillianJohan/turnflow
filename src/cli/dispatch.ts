import { readFileSync } from 'fs'
import type { Readable, Writable } from 'stream'
import { resolveToken, runMcp } from './mcp'

// Despacho por argv, antes de qualquer coisa do app (lock, janela). Puro: o index.ts injeta o resto.
export type Cli = { mode: 'app' } | { mode: 'cli'; cmd: 'mcp' | 'run'; args: string[] }

const CMDS = new Set(['mcp', 'run'])
// em dev o 1º positional é o diretório do app (`electron .` / `electron /repo`)
const looksLikePath = (a: string): boolean => a === '.' || a.includes('/') || a.includes('\\')

export function parseCli(argv: string[]): Cli {
  // argv[0] é o executável; flags (--inspect, --no-sandbox, --ozone-platform=…) não contam
  const rest = argv.slice(1)
  const positionals = rest.map((a, i) => [a, i] as const).filter(([a]) => !a.startsWith('-'))
  let pick = positionals[0]
  if (pick && !CMDS.has(pick[0]) && looksLikePath(pick[0])) pick = positionals[1]
  if (!pick || !CMDS.has(pick[0])) return { mode: 'app' }
  return { mode: 'cli', cmd: pick[0] as 'mcp' | 'run', args: rest.slice(pick[1] + 1) }
}

export interface CliDeps {
  socket: string
  env: NodeJS.ProcessEnv
  stdin: Readable
  stdout: Writable
  stderr: Writable
}

export async function runCli(cli: Extract<Cli, { mode: 'cli' }>, d: CliDeps): Promise<number> {
  if (cli.cmd === 'run') {
    d.stderr.write('run: ainda não disponível\n')
    return 1
  }
  let token: string
  try {
    token = resolveToken(d.env, cli.args, (p) => readFileSync(p, 'utf8'))
  } catch (e) {
    d.stderr.write(`--token-file: ${(e as Error).message}\n`)
    return 1
  }
  return runMcp({ socket: d.socket, stdin: d.stdin, stdout: d.stdout, stderr: d.stderr, token })
}
