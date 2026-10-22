import { describe, expect, it } from 'vitest'
import { exec, execSync } from 'child_process'
import { mkdtemp, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { HOOK_CMD, startHookServer, stateFromHook, writeHookSettings } from './hooks'

describe('stateFromHook', () => {
  it.each([
    ['UserPromptSubmit', 'working'],
    ['PreToolUse', 'working'],
    ['Notification', 'waiting'],
    ['Stop', 'waiting'],
    ['SessionStart', 'waiting'],
    ['PostToolUse', 'working'], // aprovou a permissão: voltou a trabalhar
    ['SubagentStop', null]
  ])('%s → %s', (ev, st) => expect(stateFromHook({ hook_event_name: ev })).toBe(st))
})

describe('startHookServer', () => {
  it('entrega evento com token e recusa sem', async () => {
    const got: [string, string][] = []
    const s = await startHookServer((id, st) => got.push([id, st]))
    const url = `http://127.0.0.1:${s.port}/hook/T-1`
    const body = JSON.stringify({ hook_event_name: 'PreToolUse' })
    const bad = await fetch(url, { method: 'POST', body })
    const ok = await fetch(url, { method: 'POST', body, headers: { 'x-turnflow-token': s.token } })
    await s.close()
    expect(bad.status).toBe(401)
    expect(ok.status).toBe(204)
    expect(got).toEqual([['T-1', 'working']])
  })

  it('o comando do hook via curl chega no servidor', async () => {
    const got: string[] = []
    const s = await startHookServer((id, st) => got.push(`${id}:${st}`))
    await new Promise<void>((res, rej) =>
      exec(
        HOOK_CMD,
        {
          env: {
            ...process.env,
            TURNFLOW_PORT: String(s.port),
            TURNFLOW_TOKEN: s.token,
            TURNFLOW_TASK: 'T-9'
          }
        },
        (e: Error | null) => (e ? rej(e) : res())
      ).stdin?.end(JSON.stringify({ hook_event_name: 'Stop' }))
    )
    await s.close()
    expect(got).toEqual(['T-9:waiting'])
  })
})

describe('session_id', () => {
  it('o servidor repassa o session_id do hook (é por ele que a aba descobre a conversa)', async () => {
    const got: unknown[] = []
    const s = await startHookServer((id, st, sid) => got.push([id, st, sid]))
    await fetch(`http://127.0.0.1:${s.port}/hook/~claude-1`, {
      method: 'POST',
      headers: { 'x-turnflow-token': s.token },
      body: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'abc-123' })
    })
    await s.close()
    expect(got).toEqual([['~claude-1', 'waiting', 'abc-123']])
  })
})

describe('HOOK_CMD', () => {
  it('servidor fora do ar não trava o claude: < 2s, exit 0', () => {
    const t = Date.now()
    execSync(HOOK_CMD, {
      input: '{}',
      env: { ...process.env, TURNFLOW_PORT: '9', TURNFLOW_TOKEN: 'x', TURNFLOW_TASK: 'T-1' }
    })
    expect(Date.now() - t).toBeLessThan(2000)
  })
})

describe('writeHookSettings', () => {
  it('grava os eventos com o comando', async () => {
    const p = await writeHookSettings(await mkdtemp(join(tmpdir(), 'dk-')))
    const j = JSON.parse(await readFile(p, 'utf8'))
    expect(Object.keys(j.hooks).sort()).toEqual([
      'Notification',
      'PostToolUse',
      'PreToolUse',
      'SessionStart',
      'Stop',
      'UserPromptSubmit'
    ])
    expect(j.hooks.Stop[0].hooks[0]).toEqual({ type: 'command', command: HOOK_CMD })
  })
})
