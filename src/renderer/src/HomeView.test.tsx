// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import type { TaskRow } from '../../shared/contracts'
import { HomeView } from './HomeView'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const row = (patch: Partial<TaskRow>): TaskRow =>
  ({
    id: patch.id ?? 't',
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
    group: patch.group ?? 'pendente',
    reason: null,
    blocked_reason: patch.blocked_reason ?? null,
    session: null,
    sum_where: null,
    sum_next: null,
    touched_at: '2026-10-22T11:00:00.000Z',
    faded: false,
    sort_key: '0',
    ...patch
  }) as TaskRow

const base = {
  mode: 'kanban' as const,
  showDone: false,
  narrow: false,
  onMode: () => undefined,
  onToggleDone: () => undefined,
  onOpen: () => undefined,
  doneRows: [] as TaskRow[]
}

it('kanban tem 3 colunas, Bloq. no encaminhado e a linha de paradas', () => {
  act(() =>
    root.render(
      <HomeView
        {...base}
        rows={[
          row({ id: 'a', key: 'T-1', title: 'Wait', group: 'sua_vez' }),
          row({ id: 'b', key: 'T-2', title: 'Later', group: 'pendente' }),
          row({
            id: 'c',
            key: 'T-3',
            title: 'Blocked',
            group: 'encaminhado',
            blocked_reason: 'review'
          }),
          row({ id: 'd', group: 'fila_projeto' }),
          row({ id: 'e', group: 'fila_projeto' })
        ]}
      />
    )
  )
  expect(host.querySelectorAll('.home-cols section')).toHaveLength(3)
  expect(host.textContent).toContain('Bloq.')
  expect(host.textContent).toContain('2 stalled in projects')
  const blocked = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Blocked')
  )
  expect(blocked?.textContent).toContain('T-3')
})

it('filtro Done lista as encerradas', () => {
  act(() =>
    root.render(
      <HomeView
        {...base}
        showDone
        rows={[row({ id: 'a', title: 'Open' })]}
        doneRows={[row({ id: 'z', title: 'Shipped', group: 'concluida' })]}
      />
    )
  )
  expect(host.textContent).toContain('Shipped')
  expect(host.textContent).not.toContain('Open')
})

it('painel estreito esconde a key e mantém a tag', () => {
  act(() =>
    root.render(
      <HomeView
        {...base}
        narrow
        rows={[
          row({ id: 'c', key: 'T-3', title: 'Blocked', group: 'encaminhado', blocked_reason: 'x' })
        ]}
      />
    )
  )
  const blocked = [...host.querySelectorAll('.home-cols button')].find((b) =>
    b.textContent?.includes('Blocked')
  )
  expect(blocked?.textContent).not.toContain('T-3')
  expect(blocked?.textContent).toContain('Bloq.')
})

it('linha esmaecida no Início e "N stalled" abre a lista das paradas', () => {
  const opened: string[] = []
  act(() =>
    root.render(
      <HomeView
        {...base}
        onOpen={(id) => opened.push(id)}
        rows={[
          row({ id: 'old', key: 'T-8', title: 'Old', group: 'pendente', faded: true }),
          row({ id: 'd', key: 'T-9', title: 'Parked', group: 'fila_projeto' })
        ]}
      />
    )
  )
  const old = [...host.querySelectorAll('li')].find((li) => li.textContent?.includes('Old'))
  expect(old?.classList.contains('faded')).toBe(true)
  expect(host.textContent).not.toContain('Parked')
  const stalled = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('1 stalled in projects')
  )!
  act(() => stalled.click())
  const parked = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Parked')
  )!
  act(() => parked.click())
  expect(opened).toEqual(['d'])
})
