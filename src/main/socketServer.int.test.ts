import { createConnection } from 'net'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { startSocketServer, stubMcpHandler } from './socketServer'

let root: string
const closers: Array<() => Promise<void>> = []
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sock-int-'))
})
afterEach(async () => {
  while (closers.length) await closers.pop()!()
  rmSync(root, { recursive: true, force: true })
})

const start = async (p: string): Promise<void> => {
  const s = await startSocketServer(p, stubMcpHandler)
  closers.push(() => s.close())
}

// manda linhas e devolve as linhas recebidas até `n`
const talk = (p: string, lines: string[], n: number): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const c = createConnection(p)
    let buf = ''
    c.on('error', reject)
    c.on('data', (b) => {
      buf += b
      const got = buf.split('\n').filter(Boolean)
      if (got.length >= n) {
        c.end()
        resolve(got)
      }
    })
    c.write(lines.join(''))
  })

it('cria o diretório do socket com 0700', async () => {
  const p = join(root, 'run', 'sub', 'turnflow.sock')
  await start(p)
  expect(statSync(join(root, 'run', 'sub')).mode & 0o777).toBe(0o700)
  expect(statSync(p).mode & 0o777).toBe(0o600)
})

it('socket velho (arquivo sem listener) é substituído', async () => {
  const p = join(root, 'turnflow.sock')
  writeFileSync(p, '')
  await start(p)
  expect(statSync(p).isSocket()).toBe(true)
})

it('segunda instância → ALREADY_RUNNING', async () => {
  const p = join(root, 'turnflow.sock')
  await start(p)
  await expect(startSocketServer(p, stubMcpHandler)).rejects.toThrow('ALREADY_RUNNING')
  // a primeira continua de pé
  expect(statSync(p).isSocket()).toBe(true)
})

it('stub: hello → {"ok":true}, ping → resposta JSON-RPC', async () => {
  const p = join(root, 'turnflow.sock')
  await start(p)
  const got = await talk(
    p,
    [
      '{"turnflow":"hello","v":1,"kind":"mcp","token":""}\n',
      '{"jsonrpc":"2.0","id":7,"method":"ping"}\n'
    ],
    2
  )
  expect(JSON.parse(got[0])).toEqual({ ok: true })
  expect(JSON.parse(got[1])).toEqual({ jsonrpc: '2.0', id: 7, result: {} })
})

it('stub: 1ª linha que não é hello → {"ok":false,"code":"HELLO"}', async () => {
  const p = join(root, 'turnflow.sock')
  await start(p)
  const got = await talk(p, ['{"jsonrpc":"2.0","id":1,"method":"ping"}\n'], 1)
  expect(JSON.parse(got[0])).toEqual({ ok: false, code: 'HELLO' })
})

it('close remove o arquivo do socket', async () => {
  const p = join(root, 'turnflow.sock')
  const s = await startSocketServer(p, stubMcpHandler)
  await s.close()
  expect(() => statSync(p)).toThrow()
})
