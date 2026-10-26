// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import type { TaskRow } from '../../shared/contracts'
import { AttentionList } from './AttentionList'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const NOW = Date.parse('2026-10-22T12:00:00.000Z')

const row = (patch: Partial<TaskRow>): TaskRow =>
  ({
    id: patch.id ?? 'task-1',
    key: patch.key ?? 'T-1',
    title: patch.title ?? 'Ship',
    type_id: 'feature',
    project_id: null,
    stage: {
      id: 's',
      name: 'Implementation',
      short_name: 'Impl',
      position: 1,
      count: 4,
      is_final: false
    },
    group: patch.group ?? 'sua_vez',
    reason: { kind: 'sessao_aguardando', since: '2026-10-22T11:00:00.000Z' },
    blocked_reason: patch.blocked_reason ?? null,
    session: { id: 'sess', tool: 'claude-code', state: 'waiting' },
    sum_where: null,
    sum_next: 'Next',
    touched_at: '2026-10-22T11:00:00.000Z',
    faded: false,
    sort_key: '0',
    ...patch
  }) as TaskRow

it('Enter fixa e Espaço abre em prévia; a fila de projeto fica de fora', () => {
  const opened: string[] = []
  const peeked: string[] = []
  act(() =>
    root.render(
      <AttentionList
        rows={[
          row({ id: 'a', key: 'T-1', group: 'sua_vez' }),
          row({ id: 'b', key: 'T-2', group: 'pendente', blocked_reason: 'review' }),
          row({ id: 'c', key: 'T-3', group: 'fila_projeto' })
        ]}
        density="normal"
        now={NOW}
        onOpen={(id) => opened.push(id)}
        onPeek={(id) => peeked.push(id)}
      />
    )
  )
  expect(host.textContent).toContain('Your turn')
  expect(host.textContent).toContain('T-1')
  expect(host.textContent).toContain('Pending')
  expect(host.textContent).toContain('Bloq.')
  expect(host.textContent).not.toContain('T-3')
  const box = host.querySelector('[role="listbox"]') as HTMLElement
  act(() => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(opened).toEqual(['a'])
  act(() => box.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
  expect(peeked).toEqual(['a'])
  act(() => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  act(() => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(opened).toEqual(['a', 'b'])
})
