// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, expect, it } from 'vitest'
import type { UiFile } from '../../shared/uiFile'
import { DEFAULT_UI } from '../../shared/uiFile'
import App from './App'
import { brainTask, fakeApi, stubResizeObserver, taskRow, type FakeWorld } from './testing/fakeApi'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

beforeAll(stubResizeObserver)

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0'
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
}

async function mount(world: FakeWorld): Promise<ReturnType<typeof fakeApi>> {
  const fake = fakeApi(world)
  ;(window as unknown as { turnflow: unknown }).turnflow = fake.api
  act(() => root.render(<App />))
  await flush()
  return fake
}

const tabs = (): string[] =>
  [...host.querySelectorAll('[role="tab"] .tab-label')].map((t) => t.textContent ?? '')

const withLayout = (tabIds: string[]): UiFile => ({
  ...DEFAULT_UI,
  layout: { panels: [{ tabs: tabIds, active: 0 }], focused: 0 }
})

it('task do domínio aberta pela lateral abre a visão da task (não "não existe no brain")', async () => {
  await mount({ brain: [brainTask('WF-9')], rows: [taskRow(ULID, 'T-1')] })
  const option = host.querySelector<HTMLElement>('[role="option"]')!
  act(() => option.click())
  await flush()
  expect(tabs()).toEqual([expect.stringContaining('T-1')])
  expect(host.querySelector('.task-head')?.textContent).toContain('T-1')
  expect(host.textContent).not.toMatch(/não existe|no longer exists/)
})

it('aba de task do domínio sobrevive ao restore (o retain conhece o domínio)', async () => {
  await mount({
    brain: [brainTask('WF-9')],
    rows: [taskRow(ULID, 'T-1')],
    ui: withLayout([ULID, 'WF-9'])
  })
  expect(tabs()).toEqual([expect.stringContaining('T-1'), expect.stringContaining('WF-9')])
})

it('aba de task que sumiu dos dois lados sai no restore', async () => {
  await mount({ brain: [brainTask('WF-9')], rows: [], ui: withLayout([ULID, 'WF-9']) })
  expect(tabs()).toEqual([expect.stringContaining('WF-9')])
})

it('task do domínio aberta pelo Início abre a visão da task', async () => {
  await mount({ brain: [], rows: [taskRow(ULID, 'T-1')], ui: withLayout(['~home']) })
  const card = [...host.querySelectorAll<HTMLElement>('.home button')].find((b) =>
    b.textContent?.includes('title T-1')
  )!
  act(() => card.click())
  await flush()
  expect(host.querySelector('.task-head')?.textContent).toContain('T-1')
})

const key = (code: string): void =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        code,
        key: code,
        ctrlKey: true,
        shiftKey: true,
        bubbles: true
      })
    )
  })
const paletteInput = (): HTMLInputElement =>
  host.querySelector<HTMLInputElement>('[role="dialog"] input')!
const typeIn = (value: string): void =>
  act(() => {
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    proto?.set?.call(paletteInput(), value)
    paletteInput().dispatchEvent(new Event('input', { bubbles: true }))
  })
const enter = async (): Promise<void> => {
  await act(async () => {
    paletteInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await flush()
}
const activeTab = (): string =>
  host.querySelector('[role="tab"].active .tab-label')?.textContent ?? ''

it('comandos da paleta fazem o mesmo que o atalho (fechar aba, aba N, próxima aba)', async () => {
  await mount({
    brain: [brainTask('WF-1'), brainTask('WF-2'), brainTask('WF-3')],
    ui: withLayout(['WF-1', 'WF-2', 'WF-3'])
  })
  key('KeyK')
  typeIn('> Tab 3')
  await enter()
  expect(activeTab()).toContain('WF-3')
  key('KeyK')
  typeIn('> Next tab')
  await enter()
  expect(activeTab()).toContain('WF-1')
  key('KeyK')
  typeIn('> Close tab')
  await enter()
  expect(tabs()).toEqual([expect.stringContaining('WF-2'), expect.stringContaining('WF-3')])
})

it('task do domínio achada pela paleta abre e a aba vai pro ui.json', async () => {
  const fake = fakeApi(
    { brain: [], rows: [taskRow(ULID, 'T-1')] },
    {
      searchQuery: (async () => ({
        ok: true,
        data: [{ kind: 'task', task_id: ULID, key: 'T-1', title: 'title T-1', snippet: '' }]
      })) as never
    }
  )
  ;(window as unknown as { turnflow: unknown }).turnflow = fake.api
  act(() => root.render(<App />))
  await flush()
  key('KeyK')
  typeIn('title')
  await act(async () => await new Promise((r) => setTimeout(r, 250)))
  await enter()
  expect(host.querySelector('.task-head')?.textContent).toContain('T-1')
  await act(async () => await new Promise((r) => setTimeout(r, 600)))
  const saved = fake.calls.filter((c) => c.name === 'uiSet').at(-1)?.args[0] as UiFile
  expect(saved.layout.panels[0].tabs).toEqual([ULID])
})

const focusedText = (): string => {
  const el = document.activeElement as HTMLElement | null
  return el?.getAttribute('role') === 'menuitem' ? (el.textContent ?? '') : '(no menu item focused)'
}
const pressOn = (key: string): void =>
  act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })

it('+ Novo pelo teclado: foco no primeiro item, setas andam, Esc fecha', async () => {
  await mount({ brain: [] })
  key('KeyN')
  expect(host.querySelector('[role="menu"]')).not.toBeNull()
  expect(focusedText()).toContain('Task')
  pressOn('ArrowDown')
  expect(focusedText()).toContain('Project')
  pressOn('ArrowUp')
  pressOn('ArrowUp')
  expect(focusedText()).toContain('Terminal')
  pressOn('Escape')
  expect(host.querySelector('[role="menu"]')).toBeNull()
})

it('Nome do projeto: Enter cria, erro aparece, sucesso avisa e Esc cancela', async () => {
  let fail = true
  const fake = fakeApi(
    { brain: [] },
    {
      projectCreate: (async ({ name }: { name: string }) =>
        fail
          ? { ok: false, error: { code: 'CONFLICT', message: 'Name already in use' } }
          : { ok: true, data: { id: 'p1', name } }) as never
    }
  )
  ;(window as unknown as { turnflow: unknown }).turnflow = fake.api
  act(() => root.render(<App />))
  await flush()
  key('KeyN')
  pressOn('ArrowDown')
  // no navegador o Enter num botão vira clique; o jsdom não faz isso sozinho
  act(() => (document.activeElement as HTMLElement).click())
  await flush()
  const field = document.activeElement as HTMLInputElement
  expect(field.tagName).toBe('INPUT')
  act(() => {
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    proto?.set?.call(field, 'Login')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => field.form!.requestSubmit())
  await flush()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Name already in use')
  fail = false
  await act(async () => field.form!.requestSubmit())
  await flush()
  expect(host.querySelector('form input')).toBeNull()
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Login')
  key('KeyN')
  pressOn('ArrowDown')
  // no navegador o Enter num botão vira clique; o jsdom não faz isso sozinho
  act(() => (document.activeElement as HTMLElement).click())
  await flush()
  pressOn('Escape')
  expect(host.querySelector('form input')).toBeNull()
})

it('toast de Desfazer tem texto e continua vivo depois de sair da aba', async () => {
  const row = taskRow(ULID, 'T-1', { blocked_reason: 'waiting' })
  const fake = fakeApi(
    { brain: [], rows: [row], ui: withLayout([ULID, '~home']) },
    {
      taskUnblock: (async () => ({ ok: true, data: { row: null, activity_id: 'act-9' } })) as never,
      activityUndo: (async () => ({ ok: true, data: { row: null, activity_id: null } })) as never
    }
  )
  ;(window as unknown as { turnflow: unknown }).turnflow = fake.api
  act(() => root.render(<App />))
  await flush()
  const btn = (text: string): HTMLButtonElement | undefined =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === text
    )
  act(() => btn('⋯')!.click())
  act(() => btn('Unblock')!.click())
  await flush()
  // sai da aba da task: o toast fica
  act(() => [...host.querySelectorAll<HTMLElement>('[role="tab"]')][1].click())
  await flush()
  expect(host.querySelector('.task-head')).toBeNull()
  const toast = host.querySelector('.toast')
  expect(toast?.textContent).toContain('Task unblocked')
  act(() => btn('Undo')!.click())
  await flush()
  expect(fake.calls.filter((c) => c.name === 'activityUndo').map((c) => c.args[0])).toEqual([
    { activity_id: 'act-9' }
  ])
  expect(host.querySelector('.toast')).toBeNull()
})
