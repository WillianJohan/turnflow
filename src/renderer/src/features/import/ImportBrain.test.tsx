// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ImportPreview, ImportReport } from '../../../../shared/contracts'
import { IMPORT_COPY } from '../../../../shared/copy/import'
import type { ImportApplyInput, ImportDryRunInput } from '../../../../shared/ipc/import'
import { ImportBrain } from './ImportBrain'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const counts = {
  create: 0,
  update: 1,
  link: 0,
  record_only: 0,
  unchanged: 0,
  deleted_in_app: 0,
  invalid: 0,
  conflicts: 1
}

function preview(token: string): ImportPreview {
  return {
    root: '/brain',
    token,
    type_id: 'type-1',
    flow_id: 'flow-1',
    stages: [
      { id: 's1', name: 'To do' },
      { id: 's2', name: 'Doing' }
    ],
    status_map: { problem: null, dropped: 0 },
    statuses: [
      { status: 'weird status', key: 'weird status', count: 1, target: null, source: 'none' }
    ],
    tasks: [
      {
        key: 'ABC-1',
        title: 'One',
        dir: 'current',
        action: 'update',
        fields: ['title'],
        conflicts: [{ key: 'ABC-1', field: 'title', app: 'App title', markdown: 'Md title' }],
        new_checkpoints: 0,
        new_sessions: 0,
        new_links: 0,
        project: null,
        workdir_hint: null,
        reason: null
      }
    ],
    projects: [],
    attachments: [],
    ignored: [],
    counts
  }
}

const report: ImportReport = {
  created: 0,
  updated: 1,
  linked: 0,
  record_only: 0,
  unchanged: 0,
  deleted_in_app: [],
  invalid: [],
  conflicts_kept: [],
  taken_markdown: [],
  checkpoints_added: 0,
  sessions_added: 0,
  sessions_taken: [],
  links_added: 0,
  projects_created: 0,
  ignored: [],
  warnings: []
}

type Api = {
  importDryRun: ReturnType<typeof vi.fn<(i: ImportDryRunInput) => Promise<unknown>>>
  importApply: ReturnType<typeof vi.fn<(i: ImportApplyInput) => Promise<unknown>>>
}
let api: Api

beforeEach(() => {
  let n = 0
  api = {
    importDryRun: vi.fn(async () => ({ ok: true, data: preview(`t${++n}`) })),
    importApply: vi.fn(async () => ({ ok: true, data: report }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).turnflow = {
    ...api,
    importPickFolder: vi.fn(async () => ({ ok: true, data: { path: null } })),
    taskTypeList: vi.fn(async () => ({
      ok: true,
      data: [
        {
          id: 'type-1',
          name: 'Feature',
          flow_id: 'flow-1',
          syncs: false,
          icon: null,
          guideline: null
        }
      ]
    }))
  }
})

const byTest = <T extends Element>(id: string): T =>
  host.querySelector(`[data-testid="${id}"]`) as T

async function render(): Promise<void> {
  await act(async () => root.render(<ImportBrain brainDir="/brain" />))
}

async function clickPreview(): Promise<void> {
  await act(async () => byTest<HTMLButtonElement>('import-preview').click())
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

it('Apply desabilitado sem prévia', async () => {
  await render()
  expect(byTest<HTMLButtonElement>('import-apply').disabled).toBe(true)
  expect(byTest<HTMLInputElement>('import-root').value).toBe('/brain')
  expect(api.importDryRun).not.toHaveBeenCalled()
})

it('conflito começa mantendo o app', async () => {
  await render()
  await clickPreview()
  const keep = host.querySelector('input[type=radio][value=app]') as HTMLInputElement
  const md = host.querySelector('input[type=radio][value=markdown]') as HTMLInputElement
  expect(keep.checked).toBe(true)
  expect(md.checked).toBe(false)
  expect(keep.closest('label')?.textContent).toContain(IMPORT_COPY.screen.keepApp)

  await act(async () => byTest<HTMLButtonElement>('import-apply').click())
  expect(api.importApply).toHaveBeenCalledWith(
    expect.objectContaining({ root: '/brain', token: 't1', take_markdown: [] })
  )
  expect(byTest('import-report')).not.toBeNull()
})

it('usar o markdown re-roda a prévia com a escolha', async () => {
  await render()
  await clickPreview()
  const md = host.querySelector('input[type=radio][value=markdown]') as HTMLInputElement
  await act(async () => md.click())
  expect(api.importDryRun).toHaveBeenLastCalledWith(
    expect.objectContaining({ take_markdown: [{ key: 'ABC-1', field: 'title' }] })
  )
  await act(async () => byTest<HTMLButtonElement>('import-apply').click())
  expect(api.importApply).toHaveBeenCalledWith(
    expect.objectContaining({ token: 't2', take_markdown: [{ key: 'ABC-1', field: 'title' }] })
  )
})

it('mudar o status re-roda a prévia com o edit', async () => {
  await render()
  await clickPreview()
  expect(api.importDryRun).toHaveBeenCalledTimes(1)
  await choose(byTest('import-status-weird status'), 'stage:Doing')
  expect(api.importDryRun).toHaveBeenCalledTimes(2)
  expect(api.importDryRun).toHaveBeenLastCalledWith(
    expect.objectContaining({
      root: '/brain',
      status_edits: { 'weird status': { stage: 'Doing' } }
    })
  )
  await act(async () => byTest<HTMLButtonElement>('import-apply').click())
  expect(api.importApply).toHaveBeenCalledWith(
    expect.objectContaining({ token: 't2', status_edits: { 'weird status': { stage: 'Doing' } } })
  )
})

it('erro preview_stale mostra o aviso e re-roda a prévia', async () => {
  api.importApply.mockResolvedValueOnce({
    ok: false,
    error: {
      code: 'CONFLICT',
      message: IMPORT_COPY.errors.preview_stale,
      details: { reason: 'preview_stale' }
    }
  })
  await render()
  await clickPreview()
  await choose(byTest('import-status-weird status'), 'role:blocked')
  await act(async () => byTest<HTMLButtonElement>('import-apply').click())
  expect(byTest('import-notice')?.textContent).toBe(IMPORT_COPY.screen.previewRefreshed)
  expect(byTest('import-report')).toBeNull()
  // a prévia nova leva as mesmas escolhas
  expect(api.importDryRun).toHaveBeenCalledTimes(3)
  expect(api.importDryRun).toHaveBeenLastCalledWith(
    expect.objectContaining({ status_edits: { 'weird status': { role: 'blocked' } } })
  )
  await act(async () => byTest<HTMLButtonElement>('import-apply').click())
  expect(api.importApply).toHaveBeenLastCalledWith(expect.objectContaining({ token: 't3' }))
  expect(byTest('import-report')).not.toBeNull()
})

it('outro erro do apply aparece e não re-roda a prévia', async () => {
  api.importApply.mockResolvedValueOnce({
    ok: false,
    error: { code: 'INTERNAL', message: 'boom' }
  })
  await render()
  await clickPreview()
  await act(async () => byTest<HTMLButtonElement>('import-apply').click())
  expect(byTest('import-error')?.textContent).toBe('boom')
  expect(api.importDryRun).toHaveBeenCalledTimes(1)
})

it('resposta atrasada de uma prévia antiga não vale', async () => {
  await render()
  await clickPreview()
  // a 2ª prévia (blocked) só responde depois da 3ª (Doing)
  let late!: () => void
  api.importDryRun.mockImplementationOnce(
    () => new Promise((r) => (late = () => r({ ok: true, data: preview('old') })))
  )
  await choose(byTest('import-status-weird status'), 'role:blocked')
  await choose(byTest('import-status-weird status'), 'stage:Doing')
  await act(async () => late())
  await act(async () => byTest<HTMLButtonElement>('import-apply').click())
  expect(api.importApply).toHaveBeenCalledWith(
    expect.objectContaining({ token: 't2', status_edits: { 'weird status': { stage: 'Doing' } } })
  )
})
