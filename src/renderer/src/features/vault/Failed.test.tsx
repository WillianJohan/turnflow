// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { Failed } from './Failed'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

it('desabilita o Tentar de novo enquanto o retry roda', async () => {
  let done!: () => void
  let calls = 0
  const onRetry = (): Promise<void> => {
    calls++
    return new Promise((r) => (done = r))
  }
  act(() => root.render(<Failed message="x" onRetry={onRetry} />))
  const button = host.querySelector('button.vault-primary') as HTMLButtonElement
  act(() => button.click())
  expect(button.disabled).toBe(true)
  act(() => button.click())
  expect(calls).toBe(1)
  await act(async () => done())
  expect(button.disabled).toBe(false)
})

it('volta a habilitar quando o retry falha', async () => {
  let fail!: (e: Error) => void
  const onRetry = (): Promise<void> => new Promise((_, rej) => (fail = rej))
  act(() => root.render(<Failed message="x" onRetry={onRetry} />))
  const button = host.querySelector('button.vault-primary') as HTMLButtonElement
  act(() => button.click())
  expect(button.disabled).toBe(true)
  await act(async () => fail(new Error('x')))
  expect(button.disabled).toBe(false)
})
