import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { chmod, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { BRAND } from '../shared/brand'
import type { SessionState } from '../shared/contracts'

export type HookBody = {
  hook_event_name: string
  session_id?: string
  cwd?: string
  notification_type?: string
  message?: string
}

export type HookEffect = {
  state: SessionState | null
  start: { external_id: string; cwd: string | null } | null
  prompt: boolean
  ignoredType?: string
}

const none = (): HookEffect => ({ state: null, start: null, prompt: false })

// §5, literal. Stop é idle fixo: não há chave de config que mude isso.
export function hookEffect(b: HookBody): HookEffect {
  switch (b.hook_event_name) {
    case 'SessionStart':
      return {
        state: 'idle',
        start: b.session_id ? { external_id: b.session_id, cwd: b.cwd ?? null } : null,
        prompt: false
      }
    case 'UserPromptSubmit':
      return { state: 'working', start: null, prompt: true }
    case 'PreToolUse':
    case 'PostToolUse':
      return { state: 'working', start: null, prompt: false }
    case 'Stop':
      return { state: 'idle', start: null, prompt: false }
    case 'Notification': {
      const t = b.notification_type
      if (t === 'permission_prompt' || t === 'elicitation_dialog')
        return { state: 'waiting', start: null, prompt: false }
      if (t === 'idle_prompt') return { state: 'idle', start: null, prompt: false }
      if (!t) return none()
      return { ...none(), ignoredType: t }
    }
    default:
      return none()
  }
}

export const NOTIFICATION_MATCHER = 'permission_prompt|elicitation_dialog'

// stdout do curl fica livre (sem -o /dev/null) para o E7.6 responder texto no UserPromptSubmit.
export const HOOK_CMD = `curl -s -m 1 -X POST -H "${BRAND.tokenHeader}: $TURNFLOW_SESSION_TOKEN" -H "content-type: application/json" --data-binary @- "http://127.0.0.1:$TURNFLOW_HOOK_PORT/hook" || true`

const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop'
] as const

export function hookSettings(): {
  hooks: Record<string, { matcher: string; hooks: { type: 'command'; command: string }[] }[]>
} {
  const command = { type: 'command' as const, command: HOOK_CMD }
  const hooks: Record<
    string,
    { matcher: string; hooks: { type: 'command'; command: string }[] }[]
  > = {}
  for (const ev of HOOK_EVENTS) {
    hooks[ev] = [
      {
        matcher: ev === 'Notification' ? NOTIFICATION_MATCHER : '*',
        hooks: [command]
      }
    ]
  }
  return { hooks }
}

export async function writeHookSettings(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
  const p = join(dir, 'hooks.json')
  await writeFile(p, `${JSON.stringify(hookSettings(), null, 2)}\n`, { mode: 0o600 })
  await chmod(p, 0o600)
  return p
}

export const MAX_HOOK_BODY = 1_048_576
const HEAD_BYTES = 8192

const strField = (o: Record<string, unknown>, k: string): string | undefined =>
  typeof o[k] === 'string' ? o[k] : undefined

function pickBody(o: Record<string, unknown>): HookBody {
  const body: HookBody = { hook_event_name: strField(o, 'hook_event_name') ?? '' }
  const session = strField(o, 'session_id')
  const cwd = strField(o, 'cwd')
  const notification = strField(o, 'notification_type')
  const message = strField(o, 'message')
  if (session !== undefined) body.session_id = session
  if (cwd !== undefined) body.cwd = cwd
  if (notification !== undefined) body.notification_type = notification
  if (message !== undefined) body.message = message
  return body
}

function asHookBody(v: unknown): HookBody {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { hook_event_name: '' }
  return pickBody(v as Record<string, unknown>)
}

// Corpo acima do teto: os campos que importam vêm antes do tool_input. Lê só os primeiros 8 KiB.
function fromHead(head: string): HookBody {
  const field = (key: string): string | undefined => {
    const m = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(head)
    if (!m) return undefined
    try {
      return JSON.parse(`"${m[1]}"`) as string
    } catch {
      return m[1]
    }
  }
  return pickBody({
    hook_event_name: field('hook_event_name'),
    session_id: field('session_id'),
    cwd: field('cwd'),
    notification_type: field('notification_type'),
    message: field('message')
  })
}

const header = (req: IncomingMessage, name: string): string => {
  const v = req.headers[name]
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

export async function startHookServer(o: {
  accept(token: string): boolean
  onHook(token: string, body: HookBody): void
  log?: (line: string) => void
}): Promise<{ port: number; close(): Promise<void> }> {
  const deliver = (res: ServerResponse, token: string, body: HookBody): void => {
    res.writeHead(204).end()
    try {
      o.onHook(token, body)
    } catch (e) {
      o.log?.(e instanceof Error ? e.message : String(e))
    }
  }

  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      req.socket.destroy()
      return
    }
    const port = (server.address() as AddressInfo).port
    if (req.headers.origin !== undefined) {
      req.resume()
      res.writeHead(403).end()
      return
    }
    if (header(req, 'host') !== `127.0.0.1:${port}`) {
      req.resume()
      res.writeHead(403).end()
      return
    }
    const path = req.url?.split('?')[0]
    if (req.method !== 'POST' || path !== '/hook') {
      req.resume()
      res.writeHead(404).end()
      return
    }
    const token = header(req, BRAND.tokenHeader)
    if (!o.accept(token)) {
      req.resume()
      res.writeHead(401).end()
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    let overflow = false
    req.on('data', (c: Buffer | string) => {
      if (overflow) return
      const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c)
      if (size + chunk.length > MAX_HOOK_BODY) {
        overflow = true
        const kept = Buffer.concat(chunks, size).subarray(0, HEAD_BYTES)
        const room = HEAD_BYTES - kept.length
        chunks.length = 0
        chunks.push(room > 0 ? Buffer.concat([kept, chunk.subarray(0, room)]) : kept)
        size = chunks[0]?.length ?? 0
        return
      }
      chunks.push(chunk)
      size += chunk.length
    })
    req.on('error', () => undefined)
    req.on('end', () => {
      const raw = Buffer.concat(chunks, size)
      if (overflow) {
        deliver(res, token, fromHead(raw.subarray(0, HEAD_BYTES).toString('utf8')))
        return
      }
      try {
        deliver(res, token, asHookBody(JSON.parse(raw.toString('utf8')) as unknown))
      } catch (e) {
        if (e instanceof SyntaxError) {
          res.writeHead(400).end()
          return
        }
        o.log?.(e instanceof Error ? e.message : String(e))
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
