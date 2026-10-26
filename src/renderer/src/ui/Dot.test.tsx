// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { Dot } from './Dot'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

it('o ponto leva o rótulo só para leitor de tela', () => {
  act(() => root.render(<Dot state="waiting" />))
  expect(host.querySelector('.sr-only')?.textContent).toBe('esperando você')
  expect(host.querySelector('.dot')).not.toBeNull()
})
