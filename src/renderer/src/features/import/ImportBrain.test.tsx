// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

it('foco fica no select depois da escolha, durante e depois da nova prévia', async () => {
  await render()
  await clickPreview()
  let answer!: () => void
  api.importDryRun.mockImplementationOnce(
    () => new Promise((r) => (answer = () => r({ ok: true, data: preview('t9') })))
  )
  const select = byTest<HTMLSelectElement>('import-status-weird status')
  select.focus()
  await choose(select, 'stage:Doing')
  // prévia em andamento: o controle segue usável, só o Apply espera
  expect(select.disabled).toBe(false)
  expect(byTest<HTMLButtonElement>('import-apply').disabled).toBe(true)
  expect(document.activeElement).toBe(select)
  await act(async () => answer())
  expect(document.activeElement).toBe(byTest('import-status-weird status'))
  expect(byTest<HTMLButtonElement>('import-apply').disabled).toBe(false)
})

it('nomes acessíveis: select de status e legenda do conflito com a key', async () => {
  await render()
  await clickPreview()
  expect(byTest('import-status-weird status').getAttribute('aria-label')).toBe(
    IMPORT_COPY.screen.stageFor('weird status')
  )
  expect(host.querySelector('.import-conflict legend')?.textContent).toBe(
    IMPORT_COPY.screen.conflict('ABC-1', IMPORT_COPY.screen.fields.title)
  )
})

it('motivo de task inválida vira texto na prévia e no relatório', async () => {
  const p = preview('t1')
  p.tasks[0] = { ...p.tasks[0]!, action: 'invalid', conflicts: [], reason: 'too_long:title' }
  api.importDryRun.mockResolvedValueOnce({ ok: true, data: p })
  api.importApply.mockResolvedValueOnce({
    ok: true,
    data: { ...report, invalid: [{ key: 'ABC-1', reason: 'too_long:mystery' }] }
  })
  await render()
  await clickPreview()
  const why = IMPORT_COPY.screen.reasons.tooLong(IMPORT_COPY.screen.tooLongFields.title)
  expect(byTest('import-task-ABC-1').textContent).toContain(why)
  expect(host.textContent).not.toContain('too_long')
  await act(async () => byTest<HTMLButtonElement>('import-apply').click())
  expect(byTest('import-report').textContent).toContain(
    IMPORT_COPY.screen.invalidTask('ABC-1', IMPORT_COPY.screen.reasons.unknown)
  )
  expect(host.textContent).not.toContain('too_long')
})

it('tipo fora da lista aparece como tipo padrão, nunca o id', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).turnflow.taskTypeList = vi.fn(async () => ({
    ok: false,
    error: { code: 'INTERNAL', message: 'x' }
  }))
  await render()
  await clickPreview()
  const select = byTest<HTMLSelectElement>('import-type')
  expect(select.selectedOptions[0]?.textContent).toBe(IMPORT_COPY.screen.defaultType)
  expect(host.textContent).not.toContain('type-1')
})

it('região aria-live fica montada e só troca o texto', async () => {
  await render()
  const live = byTest('import-live')
  expect(live.getAttribute('aria-live')).toBe('polite')
  await clickPreview()
  expect(byTest('import-live')).toBe(live)
})

it('prévia refeita depois do preview_stale que falha limpa o aviso', async () => {
  api.importApply.mockResolvedValueOnce({
    ok: false,
    error: { code: 'CONFLICT', message: 'stale', details: { reason: 'preview_stale' } }
  })
  await render()
  await clickPreview()
  api.importDryRun.mockResolvedValueOnce({
    ok: false,
    error: { code: 'VALIDATION', message: 'gone' }
  })
  await act(async () => byTest<HTMLButtonElement>('import-apply').click())
  expect(byTest('import-error')?.textContent).toBe('gone')
  expect(byTest('import-notice')).toBeNull()
})

it('conflito resolvido com o markdown continua na tela (a prévia nova não o lista mais)', async () => {
  let n = 0
  // como o core: com o campo em take_markdown, o conflito sai da prévia
  api.importDryRun.mockImplementation(async (i: ImportDryRunInput) => {
    const p = preview(`c${++n}`)
    if (i.take_markdown?.length) p.tasks[0] = { ...p.tasks[0]!, conflicts: [] }
    return { ok: true, data: p }
  })
  await render()
  await clickPreview()
  const radio = (v: string): HTMLInputElement =>
    host.querySelector(`input[type=radio][value=${v}]`) as HTMLInputElement
  await act(async () => radio('markdown').click())
  expect(radio('markdown')?.checked).toBe(true)
  // e dá para voltar atrás
  await act(async () => radio('app').click())
  expect(api.importDryRun).toHaveBeenLastCalledWith(expect.objectContaining({ take_markdown: [] }))
  expect(radio('app').checked).toBe(true)
})

describe('conflitos resolvidos com o markdown, reconciliados com cada prévia', () => {
  const radio = (v: string): HTMLInputElement =>
    host.querySelector(`input[type=radio][value=${v}]`) as HTMLInputElement
  type Shape = { conflict?: { app: string; markdown: string }; fields?: string[] }
  // como o core: campo em take_markdown não aparece como conflito, mas entra em `fields`
  function core(next: () => Shape): void {
    let n = 0
    api.importDryRun.mockImplementation(async (i: ImportDryRunInput) => {
      const p = preview(`r${++n}`)
      const s = next()
      const taken = !!i.take_markdown?.length
      p.tasks[0] = {
        ...p.tasks[0]!,
        conflicts: taken || !s.conflict ? [] : [{ key: 'ABC-1', field: 'title', ...s.conflict }],
        fields: s.fields ?? (taken ? ['title'] : [])
      }
      return { ok: true, data: p }
    })
  }

  it('Keep não desmonta o conflito antes da prévia nova: o foco fica no radio', async () => {
    core(() => ({ conflict: { app: 'App title', markdown: 'Md title' } }))
    await render()
    await clickPreview()
    await act(async () => radio('markdown').click())
    let answer!: () => void
    const pending = api.importDryRun.getMockImplementation()!
    api.importDryRun.mockImplementationOnce(
      (i) => new Promise((r) => (answer = () => void pending(i).then(r)))
    )
    const keep = radio('app')
    keep.focus()
    await act(async () => keep.click())
    expect(radio('app')).toBe(keep)
    expect(document.activeElement).toBe(keep)
    await act(async () => answer())
    expect(radio('app')).toBe(keep)
    expect(document.activeElement).toBe(keep)
    expect(keep.checked).toBe(true)
    expect(host.querySelectorAll('.import-conflict')).toHaveLength(1)
  })

  it('valores do conflito vêm da prévia mais nova', async () => {
    let shape: Shape = { conflict: { app: 'App title', markdown: 'Md title' } }
    core(() => shape)
    await render()
    await clickPreview()
    await act(async () => radio('markdown').click())
    shape = { conflict: { app: 'App title', markdown: 'Md title v2' } }
    await act(async () => radio('app').click())
    const values = [...host.querySelectorAll('.import-conflict .import-value')].map(
      (e) => e.textContent
    )
    expect(values).toEqual(['App title', 'Md title v2'])
    expect(host.querySelectorAll('.import-conflict')).toHaveLength(1)
  })

  it('conflito que deixou de existir sai da tela', async () => {
    let shape: Shape = { conflict: { app: 'App title', markdown: 'Md title' } }
    core(() => shape)
    await render()
    await clickPreview()
    await act(async () => radio('markdown').click())
    expect(host.querySelectorAll('.import-conflict')).toHaveLength(1)
    // o markdown agora é igual ao app: o campo não é mais escrito nem é conflito
    shape = { fields: [] }
    await choose(byTest('import-status-weird status'), 'stage:Doing')
    expect(host.querySelectorAll('.import-conflict')).toHaveLength(0)
  })
})
