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

const tab = (shift = false): void =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true })
    )
  })

it('prende o Tab: do último volta ao primeiro, Shift+Tab do primeiro vai ao último', () => {
  act(() =>
    root.render(
      <Dialog title="Rename" onClose={() => undefined}>
        <button type="button">One</button>
        <button type="button">Two</button>
        <button type="button" disabled>
          Off
        </button>
      </Dialog>
    )
  )
  expect(document.activeElement?.textContent).toBe('One')
  tab(true)
  expect(document.activeElement?.textContent).toBe('Two')
  tab()
  expect(document.activeElement?.textContent).toBe('One')
  // com o foco na própria caixa (clique no fundo do diálogo), Tab entra nela
  act(() => (host.querySelector('[role="dialog"]') as HTMLElement).focus())
  tab()
  expect(document.activeElement?.textContent).toBe('One')
})

it('respeita o autoFocus de quem está dentro', () => {
  act(() =>
    root.render(
      <Dialog title="Name" onClose={() => undefined}>
        <button type="button">Cancel</button>
        <input aria-label="Name" autoFocus />
      </Dialog>
    )
  )
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Name')
})

it('Esc e clique no fundo fecham; clique dentro não', () => {
  let closed = 0
  act(() =>
    root.render(
      <Dialog title="Rename" onClose={() => closed++}>
        <button type="button">Save</button>
      </Dialog>
    )
  )
  const box = host.querySelector('[role="dialog"]') as HTMLElement
  expect(box.getAttribute('aria-modal')).toBe('true')
  act(() => {
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  expect(closed).toBe(0)
  act(() => {
    box.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  expect(closed).toBe(1)
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
  })
  expect(closed).toBe(2)
})

it('não rouba o foco que quem fechou já levou pra outro lugar', () => {
  const opener = document.createElement('button')
  const elsewhere = document.createElement('button')
  document.body.append(opener, elsewhere)
  opener.focus()
  act(() =>
    root.render(
      <Dialog title="Rename" onClose={() => undefined}>
        <button type="button">Save</button>
      </Dialog>
    )
  )
  act(() => {
    elsewhere.focus()
    root.render(<></>)
  })
  expect(document.activeElement).toBe(elsewhere)
  opener.remove()
  elsewhere.remove()
})
