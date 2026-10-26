// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { TimelineView } from './TimelineView'
import type { TimelineItem } from './taskFace'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const items: TimelineItem[] = [
  {
    kind: 'session',
    id: 'live',
    at: '2026-10-22T12:00:00.000Z',
    text: 'claude-code',
    resumable: false
  },
  {
    kind: 'checkpoint',
    id: 'c1',
    at: '2026-10-21T10:00:00.000Z',
    text: 'noted the fix',
    resumable: false
  },
  {
    kind: 'session',
    id: 'done',
    at: '2026-10-20T12:00:00.000Z',
    text: 'login',
    resumable: true
  }
]

it('mostra checkpoints e sessões, com Retomar só na sessão encerrada e Nova sessão', () => {
  const resumed: string[] = []
  let created = 0
  act(() =>
    root.render(
      <TimelineView
        items={items}
        onResume={(id) => resumed.push(id)}
        onNew={() => {
          created += 1
        }}
      />
    )
  )
  expect(host.querySelector('.timeline')).not.toBeNull()
  expect(host.textContent).toContain('noted the fix')
  expect(host.textContent).toContain('login')
  const resume = [...host.querySelectorAll('button')].filter((button) =>
    button.textContent?.includes('Resume')
  )
  expect(resume).toHaveLength(1)
  act(() => resume[0].click())
  expect(resumed).toEqual(['done'])
  const createdButton = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('New session')
  )
  act(() => createdButton?.click())
  expect(created).toBe(1)
})
