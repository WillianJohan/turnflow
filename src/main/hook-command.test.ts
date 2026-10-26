import { execFile } from 'node:child_process'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { BRAND } from '../shared/brand'
import { HOOK_CMD, startHookServer, type HookBody } from './hooks'

// O tempo é medido dentro do bash, só em volta do HOOK_CMD: o spawn do bash (lento num CI
// carregado) fica fora do teto. Relógio: $EPOCHREALTIME (bash ≥ 5); no bash 3.2 do macOS cai no
// `date +%s%N`; sem nenhum dos dois (date BSD não tem %N) sai "none" e o teste pula, dizendo por quê.
const CLOCK =
  'now() { if [ -n "$EPOCHREALTIME" ]; then echo "$EPOCHREALTIME"; return; fi; ' +
  't=$(date +%s%N 2>/dev/null); case "$t" in ""|*[!0-9]*) echo none ;; ' +
  '*) n=${#t}; echo "${t:0:n-9}.${t:n-9:6}" ;; esac; }'
const TIMED = `${CLOCK}; s=$(now); ${HOOK_CMD}; rc=$?; echo "__T $s $(now)" >&2; exit $rc`
const NO_CLOCK = 'sem relógio sub-segundo no bash (bash < 5 e date sem %N): teto não mede'

function runHook(
  env: Record<string, string>,
  input: string,
  o: { noEpoch?: boolean } = {}
): Promise<{ code: number; ms: number | null }> {
  const script = (o.noEpoch ? 'unset EPOCHREALTIME; ' : '') + TIMED
  return new Promise((resolve, reject) => {
    const child = execFile('bash', ['-c', script], { env, timeout: 5000 }, (err, _out, errOut) => {
      const text = String(errOut)
      const m = /__T (\d+)[.,](\d+) (\d+)[.,](\d+)/.exec(text)
      if (!m && !/__T none none/.test(text)) {
        reject(err ?? new Error(`sem marca de tempo: ${text}`))
        return
      }
      const us = (sec: string, frac: string): number =>
        Number(sec) * 1e6 + Number(frac.padEnd(6, '0').slice(0, 6))
      const ms = m ? (us(m[3], m[4]) - us(m[1], m[2])) / 1000 : null
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
  it('porta fechada sai em ≤200 ms com código 0', async (ctx) => {
    const r = await runHook(envFor('1', 'x'), '{}')
    expect(r.code).toBe(0)
    if (r.ms === null) return ctx.skip(NO_CLOCK)
    expect(r.ms).toBeLessThanOrEqual(200)
  })

  it('sem $EPOCHREALTIME (bash 3.2 do macOS) o tempo sai do date +%s%N', async (ctx) => {
    const r = await runHook(envFor('1', 'x'), '{}', { noEpoch: true })
    expect(r.code).toBe(0)
    if (r.ms === null) return ctx.skip(NO_CLOCK)
    expect(r.ms).toBeGreaterThanOrEqual(0)
    expect(r.ms).toBeLessThanOrEqual(200)
  })

  it('servidor mudo sai em ≤1,2 s com código 0', async (ctx) => {
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
      if (r.ms === null) return ctx.skip(NO_CLOCK)
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
