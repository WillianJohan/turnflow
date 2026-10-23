import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import type { RendererApi } from '../src/shared/ipc/api'
import { expect, test } from './helpers'

const PASSWORD = 'senha-certa-14'
const NOW = '2026-10-22T12:00:00.000Z'
const U = '00000000-0000-4000-8000-000000000001'
const ENV_SH = resolve('e2e/fixtures/agents/env.sh')
const NOTIFY_SH = resolve('e2e/fixtures/agents/notify.sh')

async function unlock(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('pw-new').fill(PASSWORD)
  await page.getByTestId('pw-confirm').fill(PASSWORD)
  await page.getByTestId('pw-submit').click()
  await expect(page.getByTestId('words-list').locator('li')).toHaveCount(24)
  await page.getByTestId('words-saved').check()
  await page.getByTestId('words-continue').click()
  await expect(page.getByTestId('app-shell')).toBeVisible()
}

test('script roda no lugar do agente com o env da sessão', async ({ dir, launch }) => {
  const { page } = await launch('basic_text', dir, {
    HOME: dir,
    TURNFLOW_TEST_PTY: ENV_SH,
    TURNFLOW_TEST_NOW: NOW,
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'x'
  })
  await unlock(page)
  const out = await page.evaluate(async (workdir) => {
    const api = (window as unknown as { turnflow: RendererApi }).turnflow
    let text = ''
    api.onData((_id, data) => {
      text += data
    })
    const created = await api.taskCreate({ title: 'Ship', workdir })
    if (!created.ok || !created.data.row) throw new Error('task')
    const spawned = await api.ptySpawn({
      kind: 'agent',
      pty_id: created.data.row.id,
      tool: 'claude-code',
      task: created.data.row.id,
      cols: 80,
      rows: 24
    })
    if (!spawned.ok) throw new Error(spawned.error.message)
    const start = Date.now()
    while (!text.includes('TURNFLOW_SESSION_TOKEN=') && Date.now() - start < 8000)
      await new Promise((r) => setTimeout(r, 50))
    return text
  }, dir)
  expect(out).toContain('TURNFLOW_SESSION_TOKEN=')
  expect(out).toContain('TURNFLOW_TASK=T-1')
  expect(out).toContain('TURNFLOW_HOOK_PORT=')
  expect(out).not.toContain('CLAUDECODE')
  expect(out).not.toContain('CLAUDE_CODE_')
})

test('Sua vez só no permission_prompt', async ({ dir, launch }) => {
  const { page } = await launch('basic_text', dir, {
    HOME: dir,
    TURNFLOW_TEST_PTY: NOTIFY_SH,
    TURNFLOW_TEST_NOW: NOW
  })
  await unlock(page)
  const taskId = await page.evaluate(async (workdir) => {
    const api = (window as unknown as { turnflow: RendererApi }).turnflow
    const created = await api.taskCreate({ title: 'Ship', workdir })
    if (!created.ok || !created.data.row) throw new Error('task')
    const spawned = await api.ptySpawn({
      kind: 'agent',
      pty_id: created.data.row.id,
      tool: 'claude-code',
      task: created.data.row.id,
      cols: 80,
      rows: 24
    })
    if (!spawned.ok) throw new Error(spawned.error.message)
    ;(window as unknown as { __pty: string }).__pty = created.data.row.id
    return created.data.row.id
  }, dir)
  const write = (): Promise<void> =>
    page.evaluate(() => {
      const api = (window as unknown as { turnflow: RendererApi }).turnflow
      api.write({ id: (window as unknown as { __pty: string }).__pty, data: 'x\n' })
    })
  const snap = (): Promise<{ group: string; state: string; external: string | null }> =>
    page.evaluate(async (id) => {
      const api = (window as unknown as { turnflow: RendererApi }).turnflow
      const listed = await api.taskList({ scope: 'attention' })
      const sessions = await api.sessionList({ task_id: id })
      const row = listed.ok ? listed.data.find((t) => t.key === 'T-1') : undefined
      return {
        group: !listed.ok
          ? listed.error.message
          : row
            ? `${row.group}:${row.reason?.kind ?? ''}`
            : 'missing',
        state: row?.session?.state ?? '',
        external: sessions.ok ? (sessions.data[0]?.external_id ?? null) : null
      }
    }, taskId)
  await write()
  await expect.poll(async () => (await snap()).external, { timeout: 8000 }).toBe(U)
  await write()
  await expect
    .poll(async () => (await snap()).group, { timeout: 8000 })
    .toBe('sua_vez:sessao_aguardando')
  await write()
  await expect
    .poll(
      async () => {
        const s = await snap()
        return s.state === 'working' && !s.group.startsWith('sua_vez')
      },
      { timeout: 8000 }
    )
    .toBe(true)
  await write()
  await expect
    .poll(
      async () => {
        const s = await snap()
        return s.state === 'idle' && !s.group.startsWith('sua_vez')
      },
      { timeout: 8000 }
    )
    .toBe(true)
  await write()
  const until = Date.now() + 1500
  while (Date.now() < until) {
    const s = await snap()
    expect(s.state).toBe('idle')
    expect(s.group.startsWith('sua_vez')).toBe(false)
    await page.waitForTimeout(100)
  }
})

test('retomar reaproveita a sessão', async ({ dir, launch }) => {
  mkdirSync(join(dir, '.claude', 'projects', 'p'), { recursive: true })
  writeFileSync(
    join(dir, '.claude', 'projects', 'p', `${U}.jsonl`),
    `{"cwd":${JSON.stringify(dir)}}\n`
  )
  const { page } = await launch('basic_text', dir, {
    HOME: dir,
    TURNFLOW_TEST_PTY: NOTIFY_SH,
    TURNFLOW_TEST_NOW: NOW
  })
  await unlock(page)
  const opened = await page.evaluate(async (workdir) => {
    const api = (window as unknown as { turnflow: RendererApi }).turnflow
    const created = await api.taskCreate({ title: 'Ship', workdir })
    if (!created.ok || !created.data.row) throw new Error('task')
    const id = created.data.row.id
    const spawned = await api.ptySpawn({
      kind: 'agent',
      pty_id: id,
      tool: 'claude-code',
      task: id,
      cols: 80,
      rows: 24
    })
    if (!spawned.ok || !spawned.data.session_id)
      throw new Error(spawned.ok ? 'sem sessão' : spawned.error.message)
    api.write({ id, data: 'x\n' })
    const start = Date.now()
    let external: string | null = null
    while (!external && Date.now() - start < 8000) {
      const listed = await api.sessionList({ task_id: id })
      external = listed.ok ? (listed.data[0]?.external_id ?? null) : null
      if (!external) await new Promise((r) => setTimeout(r, 50))
    }
    return { taskId: id, sessionId: spawned.data.session_id, external }
  }, dir)
  expect(opened.external).toBe(U)
  await page.evaluate((id) => {
    ;(window as unknown as { turnflow: RendererApi }).turnflow.kill({ id })
  }, opened.taskId)
  await expect
    .poll(
      () =>
        page.evaluate(
          async (ids) => {
            const listed = await (
              window as unknown as { turnflow: RendererApi }
            ).turnflow.sessionList({
              task_id: ids.taskId
            })
            if (!listed.ok) return ''
            return listed.data.find((s) => s.id === ids.sessionId)?.ended_at ?? ''
          },
          { taskId: opened.taskId, sessionId: opened.sessionId }
        ),
      { timeout: 8000 }
    )
    .not.toBe('')
  const again = await page.evaluate(async (o) => {
    const api = (window as unknown as { turnflow: RendererApi }).turnflow
    const spawned = await api.ptySpawn({
      kind: 'agent',
      pty_id: o.taskId,
      tool: 'claude-code',
      task: o.taskId,
      resume: o.sessionId,
      cols: 80,
      rows: 24
    })
    if (!spawned.ok) throw new Error(spawned.error.message)
    const listed = await api.sessionList({ task_id: o.taskId })
    if (!listed.ok) throw new Error(listed.error.message)
    return listed.data.find((s) => s.id === spawned.data.session_id) ?? null
  }, opened)
  expect(again?.id).toBe(opened.sessionId)
  expect(again?.ended_at).toBeNull()
})
