// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import type { SearchHit } from '../../shared/ipc/search'
import { Palette } from './Palette'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const types = [
  { id: 'feature', name: 'Feature' },
  { id: 'bugfix', name: 'Bugfix' }
]

const input = (): HTMLInputElement => host.querySelector('input')!
const typeIn = (value: string): void => {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  proto?.set?.call(input(), value)
  input().dispatchEvent(new Event('input', { bubbles: true }))
}
const press = (key: string): void => {
  input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await act(async () => await new Promise((r) => setTimeout(r, 200)))
}

const hit = (task_id: string, key: string, title: string): SearchHit => ({
  kind: 'task',
  task_id,
  key,
  title,
  snippet: title
})

type Log = { picked: string[]; created: string[]; queries: string[] }

function render(
  o: {
    mode?: 'search' | 'new'
    hits?: SearchHit[]
    brain?: { id: string; title: string }[]
    create?: (title: string) => Promise<string | null>
  } = {}
): Log {
  const log: Log = { picked: [], created: [], queries: [] }
  act(() =>
    root.render(
      <Palette
        mode={o.mode ?? 'search'}
        brain={o.brain ?? []}
        search={async (q) => {
          log.queries.push(q)
          return o.hits ?? []
        }}
        types={types}
        projects={[{ id: 'p1', name: 'Login' }]}
        onPickTask={(id) => log.picked.push(id)}
        onCreate={async (item) => {
          log.created.push(item.title)
          return o.create ? o.create(item.title) : null
        }}
        onCommand={() => undefined}
        onClose={() => undefined}
      />
    )
  )
  return log
}

it('Enter abre a task encontrada, não cria uma nova', async () => {
  const log = render({ hits: [hit('u1', 'T-1', 'corrigir login')] })
  act(() => typeIn('corrigir login'))
  await settle()
  expect(log.queries).toContain('corrigir login')
  act(() => press('Enter'))
  expect(log.picked).toEqual(['u1'])
  expect(log.created).toEqual([])
})

it('no + Novo > Task o Enter cria (Create primeiro), com tipo adivinhado e chip', async () => {
  const log = render({ mode: 'new', hits: [hit('u1', 'T-1', 'corrigir login')] })
  act(() => typeIn('corrigir login'))
  await settle()
  expect(host.querySelector('[role="option"]')?.textContent).toMatch(/Create.*Bugfix.*Login/)
  await act(async () => press('Enter'))
  expect(log.created).toEqual(['corrigir login'])
})

it('Enter repetido durante a criação cria uma vez; erro aparece na paleta', async () => {
  let fail: (msg: string) => void = () => undefined
  const log = render({
    mode: 'new',
    create: () => new Promise<string | null>((resolve) => (fail = resolve))
  })
  act(() => typeIn('nova'))
  await settle()
  await act(async () => {
    press('Enter')
    press('Enter')
  })
  expect(log.created).toEqual(['nova'])
  await act(async () => fail('Type is required'))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Type is required')
})

it('task do brain que já é do domínio aparece uma vez só', async () => {
  render({
    hits: [hit('u1', 'WF-1', 'login novo')],
    brain: [{ id: 'WF-1', title: 'login novo' }]
  })
  act(() => typeIn('login'))
  await settle()
  const rows = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent)
  expect(rows.filter((t) => t?.includes('WF-1'))).toHaveLength(1)
})

it('setas mexem na opção ativa anunciada pelo aria-activedescendant', async () => {
  render({ hits: [hit('u1', 'T-1', 'a login'), hit('u2', 'T-2', 'b login')] })
  act(() => typeIn('login'))
  await settle()
  const first = input().getAttribute('aria-activedescendant')
  act(() => press('ArrowDown'))
  const second = input().getAttribute('aria-activedescendant')
  expect(first).toBeTruthy()
  expect(second).not.toBe(first)
  expect(document.getElementById(second!)?.getAttribute('aria-selected')).toBe('true')
  expect(document.getElementById(second!)?.textContent).toContain('T-2')
})
