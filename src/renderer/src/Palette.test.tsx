// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { COMMANDS } from './commands'
import { Palette } from './Palette'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const types = [
  { id: 'feature', name: 'Feature' },
  { id: 'bugfix', name: 'Bugfix' },
  { id: 'personal', name: 'Personal' }
]

const typeIn = (value: string): void => {
  const input = host.querySelector('input')
  if (!input) throw new Error('missing input')
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  proto?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

it('corrigir login propõe criar com Bugfix e o chip Login', () => {
  act(() =>
    root.render(
      <Palette
        tasks={[]}
        types={types}
        projects={[{ id: 'p1', name: 'Login' }]}
        onPickTask={() => undefined}
        onCreate={() => undefined}
        onCommand={() => undefined}
        onClose={() => undefined}
      />
    )
  )
  act(() => typeIn('corrigir login'))
  expect(host.textContent).toContain('Create')
  expect(host.textContent).toContain('Bugfix')
  expect(host.textContent).toContain('Login')
})

it('> lista o comando do mesmo registro', () => {
  act(() =>
    root.render(
      <Palette
        tasks={[]}
        types={types}
        projects={[]}
        onPickTask={() => undefined}
        onCreate={() => undefined}
        onCommand={() => undefined}
        onClose={() => undefined}
      />
    )
  )
  act(() => typeIn('> spl'))
  expect(host.textContent).toContain('Split')
  expect(host.textContent).not.toContain('Create')
  expect(COMMANDS.some((command) => command.label === 'Split')).toBe(true)
})
