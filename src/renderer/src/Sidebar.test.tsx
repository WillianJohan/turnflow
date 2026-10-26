// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import type { TaskRow } from '../../shared/contracts'
import type { Task } from '../../shared/types'
import { Sidebar } from './Sidebar'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const row = (id: string, key: string, group: TaskRow['group'] = 'sua_vez'): TaskRow => ({
  id,
  key,
  title: `title ${key}`,
  type_id: 'feature',
  project_id: null,
  stage: { id: 's', name: 'Impl', short_name: 'Impl', position: 1, count: 3, is_final: false },
  group,
  reason: null,
  blocked_reason: null,
  session: null,
  sum_where: null,
  sum_next: null,
  touched_at: '2026-10-22T11:00:00.000Z',
  faded: false,
  sort_key: key
})

const brain = (id: string): Task => ({
  id,
  title: `brain ${id}`,
  status: 'x',
  bucket: { idx: 0, name: 'Doing' },
  parent: null,
  dir: 'current',
  readmePath: `/b/${id}/README.md`,
  sessions: []
})

const live = { states: {}, alive: new Set<string>(), exited: {} }

const render = (attention: TaskRow[], tasks: Task[] = [brain('WF-1')]): void =>
  act(() =>
    root.render(
      <Sidebar
        tasks={tasks}
        openIds={new Set()}
        live={live}
        attention={attention}
        onOpen={() => undefined}
        onPeek={() => undefined}
        onEnd={() => undefined}
      />
    )
  )

const press = (key: string): void =>
  act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })

const options = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role="option"]')]

it('↑/↓ dentro da lista de atenção não sobem pra navegação da lateral', () => {
  render([row('a', 'T-1'), row('b', 'T-2'), row('c', 'T-3')])
  act(() => options()[0].focus())
  press('ArrowDown')
  expect(document.activeElement).toBe(options()[1])
  press('ArrowDown')
  expect(document.activeElement).toBe(options()[2])
  press('ArrowUp')
  expect(document.activeElement).toBe(options()[1])
})

it('a lista tem um único tabstop e o cursor segue a task, não a posição', () => {
  render([row('a', 'T-1'), row('b', 'T-2')])
  const listbox = host.querySelector<HTMLElement>('[role="listbox"]')!
  expect(listbox.tabIndex).toBe(-1)
  act(() => options()[1].focus())
  expect(
    options()
      .filter((o) => o.tabIndex === 0)
      .map((o) => o.textContent)
  ).toEqual([expect.stringContaining('T-2')])
  // chega uma task nova no topo: o cursor continua na T-2
  render([row('z', 'T-0'), row('a', 'T-1'), row('b', 'T-2')])
  const selected = options().filter((o) => o.getAttribute('aria-selected') === 'true')
  expect(selected.map((o) => o.textContent)).toEqual([expect.stringContaining('T-2')])
  expect(options().filter((o) => o.tabIndex === 0)).toEqual(selected)
})

it('task importada não aparece duas vezes: a árvore do brain esconde quem já está no domínio', () => {
  render([row('a', 'WF-1')], [brain('WF-1'), brain('WF-2')])
  expect(host.querySelectorAll('.item').length).toBe(1)
  expect(host.querySelector('.item')!.textContent).toContain('WF-2')
})
