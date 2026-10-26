// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { Dialog } from './Dialog'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

it('devolve o foco ao fechar o diálogo', () => {
  const opener = document.createElement('button')
  opener.textContent = 'Open'
  document.body.appendChild(opener)
  opener.focus()
  act(() =>
    root.render(
      <Dialog title="Rename" onClose={() => undefined}>
        <button type="button">Save</button>
      </Dialog>
    )
  )
  expect(document.activeElement?.textContent).toBe('Save')
  act(() => root.render(<></>))
  expect(document.activeElement).toBe(opener)
  opener.remove()
})
