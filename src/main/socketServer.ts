import { createConnection, createServer, Socket } from 'net'
import { chmodSync, mkdirSync, unlinkSync } from 'fs'
import { dirname } from 'path'
import { BRAND } from '../shared/brand'

// Socket local do app (Unix 0600 em dir 0700 / named pipe no Windows). Quem fala aqui é o
// `turnflow mcp`: 1ª linha é o hello, o resto é JSON-RPC.
const isPipe = (p: string): boolean => p.startsWith('\\\\.\\pipe\\') || p.startsWith('//./pipe/')

// tenta conectar: alguém escutando = outra instância; recusado/inexistente = socket velho
const probe = (path: string): Promise<'alive' | 'stale'> =>
  new Promise((resolve, reject) => {
    const c = createConnection(path)
    c.once('connect', () => {
      c.destroy()
      resolve('alive')
    })
    c.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ECONNREFUSED' || e.code === 'ENOENT') resolve('stale')
      else reject(e)
    })
  })

const unlinkQuiet = (p: string): void => {
  try {
    unlinkSync(p)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
}

// sun_path: 104 bytes no mac/BSD, 108 no Linux (com o NUL final)
const SUN_PATH_MAX = process.platform === 'linux' ? 107 : 103

export interface SocketServerOpts {
  // false quando o path veio de TURNFLOW_SOCKET: o dir pode ser alheio (ex.: /tmp), não dá chmod
  secureDir?: boolean
}

export async function startSocketServer(
  path: string,
  onConn: (s: Socket) => void,
  opts: SocketServerOpts = {}
): Promise<{ close(): Promise<void> }> {
  const pipe = isPipe(path)
  if (!pipe && Buffer.byteLength(path) > SUN_PATH_MAX)
    throw Object.assign(
      new Error(
        `SOCKET_PATH_TOO_LONG: ${path} (${Buffer.byteLength(path)} bytes, máx. ${SUN_PATH_MAX})`
      ),
      { code: 'SOCKET_PATH_TOO_LONG' }
    )
  if (!pipe) {
    const dir = dirname(path)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    // o dir 0700 é a proteção do socket: entre o listen e o chmod 0600 abaixo, o arquivo nasce com
    // a umask, mas ninguém além do dono atravessa o dir. Por isso aperta o dir mesmo se já existia.
    if (opts.secureDir !== false) chmodSync(dir, 0o700)
  }
  if ((await probe(path)) === 'alive')
    throw Object.assign(new Error(`ALREADY_RUNNING: ${path}`), { code: 'ALREADY_RUNNING' })
  if (!pipe) unlinkQuiet(path)
  const server = createServer(onConn)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
  if (!pipe) chmodSync(path, 0o600)
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          if (!pipe) unlinkQuiet(path)
          resolve()
        })
      })
  }
}

// Provisório até o servidor MCP real (E7): aceita qualquer hello e responde ping.
export function stubMcpHandler(s: Socket): void {
  let buf = ''
  let hello = false
  s.on('error', () => s.destroy())
  s.on('data', (b) => {
    buf += b.toString()
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      let msg: Record<string, unknown> | undefined
      try {
        msg = JSON.parse(line)
      } catch {
        msg = undefined
      }
      if (!hello) {
        if (msg?.[BRAND.id] !== 'hello') {
          s.end(JSON.stringify({ ok: false, code: 'HELLO' }) + '\n')
          return
        }
        hello = true
        s.write(JSON.stringify({ ok: true }) + '\n')
      } else if (msg?.method === 'ping' && 'id' in msg)
        s.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n')
    }
  })
}
