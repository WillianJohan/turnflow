// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { ResizeHandle } from './ResizeHandle'
import { Tag } from './Tag'
import { Tooltip } from './Tooltip'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const key = (el: Element, k: string): void =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })

it('Tag de perigo carrega o tom próprio, sem a classe de outra tela', () => {
  act(() =>
    root.render(
      <>
        <Tag tone="danger">Bloq.</Tag>
        <Tag>Info</Tag>
      </>
    )
  )
  const [danger, plain] = [...host.querySelectorAll('.ui-tag')]
  expect(danger.getAttribute('data-tone')).toBe('danger')
  expect(plain.getAttribute('data-tone')).toBe('neutral')
  expect(host.querySelector('.home-tag')).toBeNull()
})

it('Tooltip: escondido até hover/foco, ligado por aria-describedby, sem tabstop próprio', () => {
  act(() =>
    root.render(
      <Tooltip label="Search tasks">
        <button type="button">Find</button>
      </Tooltip>
    )
  )
  const button = host.querySelector('button') as HTMLButtonElement
  const bubble = host.querySelector('[role="tooltip"]') as HTMLElement
  expect(button.getAttribute('aria-describedby')).toBe(bubble.id)
  expect(bubble.id).not.toBe('')
  expect(host.querySelectorAll('[tabindex]')).toHaveLength(0)
  expect(bubble.hidden).toBe(true)
  act(() => button.focus())
  expect(bubble.hidden).toBe(false)
  key(button, 'Escape')
  expect(bubble.hidden).toBe(true)
  act(() => button.blur())
  const wrap = button.parentElement as HTMLElement
  act(() => {
    wrap.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  })
  expect(bubble.hidden).toBe(false)
  act(() => {
    wrap.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
  })
  expect(bubble.hidden).toBe(true)
})

it('ResizeHandle: setas andam 16 px dentro de min/max, Home/End vão às pontas', () => {
  let value = 288
  const changes: number[] = []
  const draw = (): void =>
    act(() =>
      root.render(
        <ResizeHandle
          label="Sidebar width"
          value={value}
          min={220}
          max={440}
          onChange={(next) => {
            changes.push(next)
            value = next
            draw()
          }}
        />
      )
    )
  draw()
  const handle = host.querySelector('[role="separator"]') as HTMLElement
  expect(handle.tabIndex).toBe(0)
  expect(handle.getAttribute('aria-valuenow')).toBe('288')
  expect(handle.getAttribute('aria-valuemin')).toBe('220')
  expect(handle.getAttribute('aria-valuemax')).toBe('440')
  key(handle, 'ArrowRight')
  key(handle, 'ArrowLeft')
  key(handle, 'ArrowLeft')
  key(handle, 'End')
  key(handle, 'ArrowRight')
  key(handle, 'Home')
  key(handle, 'ArrowLeft')
  expect(changes).toEqual([304, 288, 272, 440, 220])
  expect(handle.getAttribute('aria-valuenow')).toBe('220')
})
