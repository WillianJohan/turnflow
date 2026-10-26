// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { ShortcutDialog } from './ShortcutDialog'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const key = (code: string, key: string): void => {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code, key, ctrlKey: true, shiftKey: true, bubbles: true })
    )
  })
}

it('remap ignora Shift/Ctrl/Alt/Meta sozinhos e grava a tecla de verdade', () => {
  const bound: [string, string][] = []
  act(() =>
    root.render(
      <ShortcutDialog
        bindings={{ search: 'KeyK' }}
        onBind={(id, code) => bound.push([id, code])}
        onClose={() => undefined}
      />
    )
  )
  const search = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('Search')
  )!
  act(() => search.click())
  key('ShiftLeft', 'Shift')
  key('ControlLeft', 'Control')
  key('AltRight', 'Alt')
  key('MetaLeft', 'Meta')
  expect(bound).toEqual([])
  key('KeyJ', 'J')
  expect(bound).toEqual([['search', 'KeyJ']])
})
