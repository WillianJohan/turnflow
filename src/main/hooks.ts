import { createServer } from 'http'
import { randomBytes } from 'crypto'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { AddressInfo } from 'net'

import { BRAND } from '../shared/brand'
import type { TaskState } from '../shared/types'
export type { TaskState }

const STATE: Record<string, TaskState> = {
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PostToolUse: 'working', // depois de aprovar uma permissão, volta pro verde
  Notification: 'waiting',
  Stop: 'waiting',
  SessionStart: 'waiting'
}

export const stateFromHook = (body: { hook_event_name: string }): TaskState | null =>
  STATE[body.hook_event_name] ?? null

// Roda dentro do PTY do claude; -m 1 + `|| true` garantem que o app fora do ar nunca trava a sessão.
export const HOOK_CMD = `curl -s -m 1 -o /dev/null -H "${BRAND.tokenHeader}: $TURNFLOW_TOKEN" --data-binary @- "http://127.0.0.1:$TURNFLOW_PORT/hook/$TURNFLOW_TASK" || true`

export async function startHookServer(
  onEvent: (
    taskId: string,
    state: TaskState,
    sessionId?: string,
    info?: { event: string; message?: string }
  ) => void
): Promise<{ port: number; token: string; close(): Promise<void> }> {
  const token = randomBytes(16).toString('hex')
  const server = createServer((req, res) => {
    const m = req.url?.match(/^\/hook\/([^/?]+)$/)
    if (req.method !== 'POST' || !m) {
      res.writeHead(404).end()
      return
    }
    if (req.headers[BRAND.tokenHeader] !== token) {
      res.writeHead(401).end()
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.writeHead(204).end()
      try {
        const b = JSON.parse(body)
        const st = stateFromHook(b)
        if (st)
          onEvent(
            decodeURIComponent(m[1]),
            st,
            typeof b.session_id === 'string' ? b.session_id : undefined,
            {
              event: b.hook_event_name,
              message: typeof b.message === 'string' ? b.message : undefined
            }
          )
      } catch {
        // corpo inválido: ignora
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return {
    port: (server.address() as AddressInfo).port,
    token,
    close: () => new Promise((r) => server.close(() => r()))
  }
}

export async function writeHookSettings(dir: string): Promise<string> {
  const entry = [{ matcher: '*', hooks: [{ type: 'command', command: HOOK_CMD }] }]
  const hooks = Object.fromEntries(Object.keys(STATE).map((ev) => [ev, entry]))
  await mkdir(dir, { recursive: true })
  const p = join(dir, 'hooks.json')
  await writeFile(p, JSON.stringify({ hooks }, null, 2))
  return p
}
