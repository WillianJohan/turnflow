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
