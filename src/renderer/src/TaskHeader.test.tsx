// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { TaskHeader } from './TaskHeader'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const summary = {
  sum_what: null,
  sum_where: null,
  sum_next: null,
  checkpoints: [{ at: '2026-10-22T10:00:00.000Z', text: 'shipped the login fix' }]
}

const stages = [
  { id: 's1', short_name: 'Todo', position: 1 },
  { id: 's2', short_name: 'Impl', position: 2 }
]

it('sem resumo mostra último registro, Editar, a barra de etapa e o menu', () => {
  const actions: string[] = []
  const stagesPicked: string[] = []
  act(() =>
    root.render(
      <TaskHeader
        taskKey="T-1"
        title="Login"
        summary={summary}
        stages={stages}
        stageId="s2"
        blocked={false}
        toast={null}
        now={0}
        onSave={() => undefined}
        onStage={(id) => stagesPicked.push(id)}
        onAction={(id) => actions.push(id)}
        onUndo={() => undefined}
      />
    )
  )
  expect(host.textContent).toContain('Last record')
  expect(host.textContent).toContain('shipped the login fix')
  expect(host.textContent).toContain('Edit')
  const menu = [...host.querySelectorAll('button')].find((button) => button.textContent === '⋯')
  act(() => menu?.click())
  for (const label of [
    'Record',
    'Sessions',
    'Working folder',
    'Previous stage',
    'Move',
    'Block',
    'Close'
  ]) {
    expect(host.textContent).toContain(label)
  }
  const close = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Close'
  )
  act(() => close?.click())
  expect(actions).toEqual(['close'])
  const impl = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Impl')
  act(() => impl?.click())
  expect(stagesPicked).toEqual(['s2'])
})

it('Editar grava as duas linhas e o toast de 8 s oferece Desfazer', () => {
  const saved: unknown[] = []
  let undone = 0
  act(() =>
    root.render(
      <TaskHeader
        taskKey="T-1"
        title="Login"
        summary={summary}
        stages={stages}
        stageId="s1"
        blocked={false}
        toast={{ activityId: 'act-1', until: 8_000 }}
        now={1_000}
        onSave={(patch) => saved.push(patch)}
        onStage={() => undefined}
        onAction={() => undefined}
        onUndo={() => {
          undone += 1
        }}
      />
    )
  )
  const edit = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Edit')
  act(() => edit?.click())
  const fields = [...host.querySelectorAll('input')]
  act(() => {
    const what = fields[0]
    const next = fields[1]
    const set = (el: HTMLInputElement, value: string): void => {
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      proto?.set?.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set(what, 'parser accepts empty')
    set(next, 'cover the error path')
  })
  const save = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Save')
  act(() => save?.click())
  expect(saved).toEqual([{ sum_what: 'parser accepts empty', sum_next: 'cover the error path' }])
  const undo = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Undo')
  act(() => undo?.click())
  expect(undone).toBe(1)
})
