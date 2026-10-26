// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { IconPicker } from './IconPicker'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const show = (value = 'icon:check'): void =>
  act(() =>
    root.render(<IconPicker value={value} onPick={() => undefined} onClose={() => undefined} />)
  )

it('cada amostra de cor tem nome em inglês e o campo de cor livre começa no cinza médio', () => {
  show()
  const swatches = [...host.querySelectorAll<HTMLButtonElement>('.ip-swatch:not(.custom)')]
  const names = swatches.map((button) => button.getAttribute('aria-label'))
  expect(names).toEqual([
    'Text color',
    'Gray',
    'Brown',
    'Orange',
    'Yellow',
    'Green',
    'Blue',
    'Purple',
    'Pink',
    'Red'
  ])
  expect(host.querySelector<HTMLInputElement>('input[type="color"]')?.value).toBe('#888888')
})
