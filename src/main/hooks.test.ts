import http from 'node:http'
import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { BRAND } from '../shared/brand'
import { DEFAULT_CONFIG } from './appConfig'
import {
  HOOK_CMD,
  MAX_HOOK_BODY,
  NOTIFICATION_MATCHER,
  hookEffect,
  hookSettings,
  startHookServer,
  type HookBody,
  type HookEffect
} from './hooks'

const SID = '00000000-0000-4000-8000-000000000001'

const base: HookEffect = { state: null, start: null, prompt: false }

describe('hookEffect', () => {
  it.each<{ name: string; body: HookBody; effect: HookEffect }>([
    {
      name: 'SessionStart',
      body: { hook_event_name: 'SessionStart', session_id: SID, cwd: '/w' },
      effect: { state: 'idle', start: { external_id: SID, cwd: '/w' }, prompt: false }
    },
    {
      name: 'SessionStart sem session_id',
      body: { hook_event_name: 'SessionStart' },
      effect: { state: 'idle', start: null, prompt: false }
    },
    {
      name: 'UserPromptSubmit',
      body: { hook_event_name: 'UserPromptSubmit' },
      effect: { state: 'working', start: null, prompt: true }
    },
    {
      name: 'PreToolUse',
      body: { hook_event_name: 'PreToolUse' },
      effect: { state: 'working', start: null, prompt: false }
    },
    {
      name: 'PostToolUse',
      body: { hook_event_name: 'PostToolUse' },
      effect: { state: 'working', start: null, prompt: false }
    },
    {
      name: 'Notification permission_prompt',
      body: { hook_event_name: 'Notification', notification_type: 'permission_prompt' },
      effect: { state: 'waiting', start: null, prompt: false }
    },
    {
      name: 'Notification elicitation_dialog',
      body: { hook_event_name: 'Notification', notification_type: 'elicitation_dialog' },
      effect: { state: 'waiting', start: null, prompt: false }
    },
    {
      name: 'Notification idle_prompt',
      body: { hook_event_name: 'Notification', notification_type: 'idle_prompt' },
      effect: { state: 'idle', start: null, prompt: false }
    },
    {
      name: 'Notification auth_success',
      body: { hook_event_name: 'Notification', notification_type: 'auth_success' },
      effect: { ...base, ignoredType: 'auth_success' }
    },
    {
      name: 'Notification sem notification_type',
      body: { hook_event_name: 'Notification' },
      effect: base
    },
    {
      name: 'Stop',
      body: { hook_event_name: 'Stop' },
      effect: { state: 'idle', start: null, prompt: false }
    },
    {
      name: 'SessionEnd',
      body: { hook_event_name: 'SessionEnd' },
      effect: base
    },
    {
      name: 'SubagentStop',
      body: { hook_event_name: 'SubagentStop' },
      effect: base
    }
  ])('mapa hook → estado ($name)', ({ body, effect }) => {
    expect(hookEffect(body)).toEqual(effect)
  })

  it('Stop = idle sem opção', () => {
    expect(hookEffect.length).toBe(1)
    expect(hookEffect({ hook_event_name: 'Stop' }).state).toBe('idle')
    for (const key of Object.keys(DEFAULT_CONFIG)) expect(key).not.toMatch(/stop|hook/i)
  })
})

describe('hookSettings', () => {
  it('settings registra o Notification com o matcher', () => {
    const hooks = hookSettings().hooks
    expect(NOTIFICATION_MATCHER).toBe('permission_prompt|elicitation_dialog')
    expect(hooks.Notification[0].matcher).toBe(NOTIFICATION_MATCHER)
    expect(hooks.Notification[0].hooks).toEqual([{ type: 'command', command: HOOK_CMD }])
    for (const ev of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']) {
      expect(hooks[ev][0].matcher).toBe('*')
      expect(hooks[ev][0].hooks).toEqual([{ type: 'command', command: HOOK_CMD }])
    }
    expect(hooks.SessionEnd).toBeUndefined()
    expect(Object.keys(hooks)).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'Notification',
      'Stop'
    ])
    expect(HOOK_CMD).toBe(
      `curl -s -m 1 -X POST -H "${BRAND.tokenHeader}: $TURNFLOW_SESSION_TOKEN" -H "content-type: application/json" --data-binary @- "http://127.0.0.1:$TURNFLOW_HOOK_PORT/hook" || true`
    )
  })
})

async function withServer(
  accept: (token: string) => boolean,
  onHook: (token: string, body: HookBody) => void,
  fn: (port: number) => Promise<void>,
  log?: (line: string) => void
): Promise<void> {
  const s = await startHookServer({ accept, onHook, log })
  try {
    await fn(s.port)
  } finally {
    await s.close()
  }
}

function post(
  port: number,
  body: string,
  headers: Record<string, string> = {}
): Promise<{ status: number }> {
  return fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body
  }).then((r) => ({ status: r.status }))
}

describe('startHookServer', () => {
  it('token aceito → 204 e onHook (com message)', async () => {
    const got: { token: string; body: HookBody }[] = []
    await withServer(
      (t) => t === 'secret',
      (token, body) => got.push({ token, body }),
      async (port) => {
        const res = await post(
          port,
          JSON.stringify({
            hook_event_name: 'Notification',
            notification_type: 'permission_prompt',
            message: 'allow?'
          }),
          { [BRAND.tokenHeader]: 'secret' }
        )
        expect(res.status).toBe(204)
      }
    )
    expect(got).toEqual([
      {
        token: 'secret',
        body: {
          hook_event_name: 'Notification',
          notification_type: 'permission_prompt',
          message: 'allow?'
        }
      }
    ])
  })

  it('token desconhecido → 401 sem onHook', async () => {
    const got: HookBody[] = []
    await withServer(
      (t) => t === 'secret',
      (_token, body) => got.push(body),
      async (port) => {
        const res = await post(port, '{}', { [BRAND.tokenHeader]: 'nope' })
        expect(res.status).toBe(401)
      }
    )
    expect(got).toEqual([])
  })

  it('Origin → 403', async () => {
    await withServer(
      () => true,
      () => undefined,
      async (port) => {
        const res = await post(port, '{}', {
          [BRAND.tokenHeader]: 'secret',
          Origin: 'http://evil.example'
        })
        expect(res.status).toBe(403)
      }
    )
  })

  it('Host diferente → 403', async () => {
    await withServer(
      () => true,
      () => undefined,
      async (port) => {
        const status = await new Promise<number>((resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port,
              path: '/hook',
              method: 'POST',
              headers: { Host: `localhost:${port}`, [BRAND.tokenHeader]: 'secret' }
            },
            (res) => {
              res.resume()
              resolve(res.statusCode ?? 0)
            }
          )
          req.on('error', reject)
          req.end('{}')
        })
        expect(status).toBe(403)
      }
    )
  })

  it('OPTIONS não responde', async () => {
    await withServer(
      () => true,
      () => undefined,
      async (port) => {
        const bytes = await new Promise<number>((resolve, reject) => {
          let n = 0
          const sock = net.connect(port, '127.0.0.1')
          const timer = setTimeout(() => {
            sock.destroy()
            reject(new Error('OPTIONS ficou aberto'))
          }, 1000)
          sock.on('data', (c) => {
            n += c.length
          })
          sock.on('connect', () => {
            sock.write(`OPTIONS /hook HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`)
          })
          const done = (): void => {
            clearTimeout(timer)
            resolve(n)
          }
          sock.on('close', done)
          sock.on('error', done)
        })
        expect(bytes).toBe(0)
      }
    )
  })

  it('path /hook/T-1 → 404', async () => {
    await withServer(
      () => true,
      () => undefined,
      async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/hook/T-1`, {
          method: 'POST',
          headers: { [BRAND.tokenHeader]: 'secret' },
          body: '{}'
        })
        expect(res.status).toBe(404)
      }
    )
  })

  it('JSON inválido → 400', async () => {
    const got: HookBody[] = []
    await withServer(
      () => true,
      (_token, body) => got.push(body),
      async (port) => {
        const res = await post(port, '{', { [BRAND.tokenHeader]: 'secret' })
        expect(res.status).toBe(400)
      }
    )
    expect(got).toEqual([])
  })

  it('onHook que lança não derruba o próximo request', async () => {
    let n = 0
    const logs: string[] = []
    await withServer(
      () => true,
      () => {
        n += 1
        if (n === 1) throw new Error('boom')
      },
      async (port) => {
        const a = await post(port, JSON.stringify({ hook_event_name: 'Stop' }), {
          [BRAND.tokenHeader]: 'secret'
        })
        const b = await post(port, JSON.stringify({ hook_event_name: 'Stop' }), {
          [BRAND.tokenHeader]: 'secret'
        })
        expect(a.status).toBe(204)
        expect(b.status).toBe(204)
      },
      (line) => logs.push(line)
    )
    expect(n).toBe(2)
    expect(logs.join('\n')).toMatch(/boom/)
  })

  it('corpo de 2 MiB entrega o evento pelos primeiros bytes', async () => {
    const got: HookBody[] = []
    const raw = JSON.stringify({
      hook_event_name: 'PostToolUse',
      session_id: SID,
      tool_response: 'x'.repeat(2 * 1024 * 1024)
    })
    expect(Buffer.byteLength(raw)).toBeGreaterThan(MAX_HOOK_BODY)
    await withServer(
      () => true,
      (_token, body) => got.push(body),
      async (port) => {
        const res = await post(port, raw, { [BRAND.tokenHeader]: 'secret' })
        expect(res.status).toBe(204)
      }
    )
    expect(got).toEqual([{ hook_event_name: 'PostToolUse', session_id: SID }])
  })

  it("filtro do main vale com o hook em '*'", async () => {
    const got: HookBody[] = []
    await withServer(
      () => true,
      (_token, body) => got.push(body),
      async (port) => {
        for (const notification_type of ['idle_prompt', 'auth_success']) {
          const res = await post(
            port,
            JSON.stringify({ hook_event_name: 'Notification', notification_type }),
            { [BRAND.tokenHeader]: 't' }
          )
          expect(res.status).toBe(204)
        }
      }
    )
    expect(hookEffect(got[0]).state).toBe('idle')
    expect(hookEffect(got[1]).state).toBeNull()
    expect(hookEffect(got[1]).ignoredType).toBe('auth_success')
  })
})
