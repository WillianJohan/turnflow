import { execFile } from 'node:child_process'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { BRAND } from '../shared/brand'
import { HOOK_CMD, startHookServer, type HookBody } from './hooks'

// O tempo é medido dentro do bash, só em volta do HOOK_CMD: o spawn do bash (lento num CI
// carregado) fica fora do teto.
const TIMED = `s=$EPOCHREALTIME; ${HOOK_CMD}; rc=$?; echo "__T $s $EPOCHREALTIME" >&2; exit $rc`

function runHook(
  env: Record<string, string>,
  input: string
): Promise<{ code: number; ms: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile('bash', ['-c', TIMED], { env, timeout: 5000 }, (err, _out, errOut) => {
      const m = /__T (\d+)[.,](\d+) (\d+)[.,](\d+)/.exec(String(errOut))
      if (!m) {
        reject(err ?? new Error(`sem marca de tempo: ${errOut}`))
        return
      }
      const us = (sec: string, frac: string): number => Number(sec) * 1e6 + Number(frac)
      const ms = (us(m[3], m[4]) - us(m[1], m[2])) / 1000
      if (!err) {
        resolve({ code: 0, ms })
        return
      }
      const code = 'code' in err && typeof err.code === 'number' ? err.code : null
      if (code === null) {
        reject(err)
        return
      }
      resolve({ code, ms })
    })
    child.stdin?.end(input)
  })
}

const envFor = (port: string, token: string): Record<string, string> => ({
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  TURNFLOW_HOOK_PORT: port,
  TURNFLOW_SESSION_TOKEN: token
})

describe('HOOK_CMD', () => {
  it('porta fechada sai em ≤200 ms com código 0', async () => {
    const r = await runHook(envFor('1', 'x'), '{}')
    expect(r.code).toBe(0)
    expect(r.ms).toBeLessThanOrEqual(200)
  })

  it('servidor mudo sai em ≤1,2 s com código 0', async () => {
    const sockets = new Set<net.Socket>()
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port
    try {
      const r = await runHook(envFor(String(port), 'x'), '{}')
      expect(r.code).toBe(0)
      expect(r.ms).toBeGreaterThanOrEqual(800)
      expect(r.ms).toBeLessThanOrEqual(1200)
    } finally {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('servidor real recebe o corpo e o token', async () => {
    const got: { token: string; body: HookBody }[] = []
    const server = await startHookServer({
      accept: (t) => t === 'secret',
      onHook: (token, body) => got.push({ token, body })
    })
    try {
      const r = await runHook(
        envFor(String(server.port), 'secret'),
        JSON.stringify({
          hook_event_name: 'Stop',
          session_id: '00000000-0000-4000-8000-000000000001'
        })
      )
      expect(r.code).toBe(0)
    } finally {
      await server.close()
    }
    expect(got).toEqual([
      {
        token: 'secret',
        body: {
          hook_event_name: 'Stop',
          session_id: '00000000-0000-4000-8000-000000000001'
        }
      }
    ])
    expect(HOOK_CMD).toContain(BRAND.tokenHeader)
  })
})
