import { createConnection, Socket } from 'net'
import type { Readable, Writable } from 'stream'
import { BRAND } from '../shared/brand'

// `turnflow mcp`: ponte stdio ↔ socket local. Manda o hello, espera {"ok":true} e daí repassa
// os bytes nos dois sentidos sem interpretar nada (o servidor MCP mora no main).
const ENV = BRAND.envPrefix

export const notOpenMsg = (): string => `${BRAND.name} não está aberto\n`

export function resolveToken(
  env: NodeJS.ProcessEnv,
  args: string[],
  readFile: (p: string) => string
): string {
  const session = env[`${ENV}SESSION_TOKEN`]
  if (session) return session
  const i = args.findIndex((a) => a === '--token-file' || a.startsWith('--token-file='))
  if (i >= 0) {
    const file = args[i].includes('=') ? args[i].slice(args[i].indexOf('=') + 1) : args[i + 1]
    if (file) return readFile(file).trim()
  }
  return env[`${ENV}MCP_TOKEN`] ?? ''
}

export const helloLine = (token: string): string =>
  JSON.stringify({ [BRAND.id]: 'hello', v: 1, kind: 'mcp', token }) + '\n'

export interface McpOpts {
  socket: string
  stdin: Readable
  stdout: Writable
  stderr: Writable
  token?: string
  connect?: (p: string) => Socket
  timeoutMs?: number
}

// garante que o que foi escrito saiu antes do app.exit(), com teto: stream travado/morto não segura
const FLUSH_CAP_MS = 500
const flush = (w: Writable): Promise<void> =>
  new Promise((r) => {
    const t = setTimeout(r, FLUSH_CAP_MS)
    const done = (): void => {
      clearTimeout(t)
      r()
    }
    if (w.destroyed || w.writableEnded) return done()
    try {
      w.write('', done)
    } catch {
      done()
    }
  })

export function runMcp(opts: McpOpts): Promise<number> {
  const { stdin, stdout, stderr } = opts
  const sock = (opts.connect ?? createConnection)(opts.socket)
  let settled = false
  let piping = false

  return new Promise<number>((resolve) => {
    const finish = async (code: number, msg?: string): Promise<void> => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stdin.unpipe(sock)
      if (msg && !stderr.destroyed) stderr.write(msg)
      await Promise.all([flush(stdout), flush(stderr)])
      sock.destroy()
      resolve(code)
    }
    const timer = setTimeout(() => finish(1, notOpenMsg()), opts.timeoutMs ?? 1000)

    sock.on('error', (e: NodeJS.ErrnoException) => {
      if (piping) finish(1, `conexão com o ${BRAND.name} caiu: ${e.code ?? e.message}\n`)
      else finish(1, notOpenMsg())
    })
    sock.on('close', () => {
      if (piping) finish(0)
      else finish(1, notOpenMsg())
    })
    sock.once('connect', () => sock.write(helloLine(opts.token ?? '')))
    // EPIPE no stdout (cliente MCP morreu) ou erro no stdin não pode virar exceção solta
    stdout.on('error', () => finish(1))
    stdin.on('error', () => finish(1))
    stderr.on('error', () => {})

    // até o \n do {"ok":...}, acumula; o resto do mesmo chunk já é dado do servidor
    let head = Buffer.alloc(0)
    const onHead = (b: Buffer): void => {
      head = Buffer.concat([head, b])
      const nl = head.indexOf(10)
      if (nl < 0) return
      sock.off('data', onHead)
      let reply: { ok?: unknown; code?: unknown } = {}
      try {
        reply = JSON.parse(head.subarray(0, nl).toString())
      } catch {
        // resposta ilegível cai no ok:false abaixo
      }
      if (reply.ok !== true) {
        finish(1, `${BRAND.name} recusou a conexão: ${String(reply.code ?? 'HELLO')}\n`)
        return
      }
      clearTimeout(timer)
      piping = true
      const rest = head.subarray(nl + 1)
      if (rest.length) stdout.write(rest)
      sock.pipe(stdout, { end: false })
      stdin.pipe(sock)
    }
    sock.on('data', onHead)
  })
}
