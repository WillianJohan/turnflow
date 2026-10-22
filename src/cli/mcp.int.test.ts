import { createServer, Server, Socket } from 'net'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { runMcp } from './mcp'

let dir: string
let server: Server | undefined
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-int-'))
})
afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r))
  server = undefined
  rmSync(dir, { recursive: true, force: true })
})

const io = (): { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough } => ({
  stdin: new PassThrough(),
  stdout: new PassThrough(),
  stderr: new PassThrough()
})
const text = (s: PassThrough): string => (s.read() ?? '').toString()

const listen = (path: string, onConn: (s: Socket) => void): Promise<void> =>
  new Promise((r) => {
    server = createServer(onConn)
    server.listen(path, () => r())
  })

it('socket inexistente → 1 em ≤1 s com a mensagem', async () => {
  const s = io()
  const t0 = Date.now()
  const code = await runMcp({ socket: join(dir, 'nada.sock'), ...s })
  expect(code).toBe(1)
  expect(Date.now() - t0).toBeLessThanOrEqual(1000)
  expect(text(s.stderr)).toContain('não está aberto')
})

it('arquivo de socket órfão sem listener → 1 em ≤1 s', async () => {
  const sock = join(dir, 'orfao.sock')
  writeFileSync(sock, '')
  const s = io()
  const t0 = Date.now()
  expect(await runMcp({ socket: sock, ...s })).toBe(1)
  expect(Date.now() - t0).toBeLessThanOrEqual(1000)
  expect(text(s.stderr)).toContain('não está aberto')
})

it('servidor que aceita e nunca responde o hello → 1 no timeout', async () => {
  const sock = join(dir, 'mudo.sock')
  await listen(sock, (c) => c.resume()) // lê (e descarta) pra enxergar o EOF
  const s = io()
  const t0 = Date.now()
  expect(await runMcp({ socket: sock, ...s, timeoutMs: 200 })).toBe(1)
  expect(Date.now() - t0).toBeLessThan(1000)
  expect(text(s.stderr)).toContain('não está aberto')
})

it('hello ok → pipe byte a byte nos dois sentidos, 0 quando o servidor fecha', async () => {
  const sock = join(dir, 'eco.sock')
  let hello = ''
  const received: Buffer[] = []
  await listen(sock, (c) => {
    let first = true
    c.on('data', (b) => {
      if (first) {
        const nl = b.indexOf(10)
        hello = b.subarray(0, nl).toString()
        first = false
        c.write('{"ok":true}\n')
        if (nl + 1 < b.length) received.push(b.subarray(nl + 1))
        return
      }
      received.push(b)
      // eco e fecha depois do segundo bloco
      c.write(b)
      if (Buffer.concat(received).includes('FIM')) c.end()
    })
  })
  const s = io()
  const done = runMcp({ socket: sock, ...s, token: 'tok' })
  const payload = '{"jsonrpc":"2.0","id":1,"method":"ping"}\n\u00e7\u0000\xff FIM\n'
  s.stdin.write(payload)
  expect(await done).toBe(0)
  expect(JSON.parse(hello)).toEqual({ turnflow: 'hello', v: 1, kind: 'mcp', token: 'tok' })
  expect(Buffer.concat(received).toString()).toBe(payload)
  expect(text(s.stdout)).toBe(payload)
})

it('stdin fecha → meia-conexão fecha, servidor encerra e devolve 0', async () => {
  const sock = join(dir, 'eof.sock')
  await listen(sock, (c) => {
    c.once('data', () => c.write('{"ok":true}\n'))
  })
  const s = io()
  const done = runMcp({ socket: sock, ...s })
  setTimeout(() => s.stdin.end(), 50)
  expect(await done).toBe(0)
})

it('{"ok":false,"code":"AUTH"} → 1 com o code no stderr', async () => {
  const sock = join(dir, 'auth.sock')
  await listen(sock, (c) => {
    c.once('data', () => c.end('{"ok":false,"code":"AUTH"}\n'))
  })
  const s = io()
  expect(await runMcp({ socket: sock, ...s })).toBe(1)
  expect(text(s.stderr)).toContain('AUTH')
})
