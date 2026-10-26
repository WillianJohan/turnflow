// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { Menu } from './Menu'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const ITEMS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' }
]
const key = (k: string, el: Element | null = document.activeElement): void =>
  act(() => {
    el?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
const trigger = (): HTMLButtonElement =>
  host.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement
const focused = (): string | null | undefined => document.activeElement?.textContent
const menu = (): Element | null => host.querySelector('[role="menu"]')

function show(onPick: (id: string) => void = () => undefined): void {
  act(() => root.render(<Menu label="More" items={ITEMS} onPick={onPick} />))
}

it('abre com o foco no primeiro item; setas dão a volta; Home/End; Esc devolve ao gatilho', () => {
  show()
  act(() => trigger().focus())
  act(() => trigger().click())
  expect(trigger().getAttribute('aria-expanded')).toBe('true')
  expect(focused()).toBe('Alpha')
  key('ArrowDown')
  expect(focused()).toBe('Beta')
  key('End')
  expect(focused()).toBe('Gamma')
  key('ArrowDown')
  expect(focused()).toBe('Alpha')
  key('ArrowUp')
  expect(focused()).toBe('Gamma')
  key('Home')
  expect(focused()).toBe('Alpha')
  key('Escape')
  expect(menu()).toBeNull()
  expect(document.activeElement).toBe(trigger())
  expect(trigger().getAttribute('aria-expanded')).toBe('false')
})

it('↓ e ↑ no gatilho abrem no primeiro e no último', () => {
  show()
  act(() => trigger().focus())
  key('ArrowDown')
  expect(focused()).toBe('Alpha')
  key('Escape')
  key('ArrowUp')
  expect(focused()).toBe('Gamma')
})

it('escolher fecha, chama onPick e devolve o foco ao gatilho', () => {
  const picked: string[] = []
  show((id) => picked.push(id))
  act(() => trigger().click())
  key('ArrowDown')
  act(() => (document.activeElement as HTMLButtonElement).click())
  expect(picked).toEqual(['b'])
  expect(menu()).toBeNull()
  expect(document.activeElement).toBe(trigger())
})

it('clique fora e Tab fecham', () => {
  show()
  act(() => trigger().click())
  act(() => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  expect(menu()).toBeNull()
  act(() => trigger().click())
  expect(menu()).not.toBeNull()
  key('Tab')
  expect(menu()).toBeNull()
})

it('controlado: o gatilho pede a troca e o dono decide', () => {
  const asked: boolean[] = []
  function Owner(): React.JSX.Element {
    const [open, setOpen] = useState(true)
    return (
      <Menu
        label="More"
        items={ITEMS}
        open={open}
        onOpenChange={(next) => {
          asked.push(next)
          setOpen(next)
        }}
      />
    )
  }
  act(() => root.render(<Owner />))
  expect(menu()).not.toBeNull()
  act(() => trigger().click())
  expect(asked).toEqual([false])
  expect(menu()).toBeNull()
  act(() => trigger().click())
  expect(asked).toEqual([false, true])
  expect(menu()).not.toBeNull()
})
