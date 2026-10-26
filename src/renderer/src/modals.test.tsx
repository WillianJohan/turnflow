// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { IconPicker } from './IconPicker'
import { Palette } from './Palette'
import { ProjectDialog } from './ProjectDialog'
import { ShortcutDialog } from './ShortcutDialog'

// Os modais reais da tela nova sobre o ui/Dialog: foco preso no Tab, Esc fecha uma vez só e o foco
// volta a quem abriu.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const key = (k: string, shift = false): void =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true })
    )
  })

const MODALS: [string, (close: () => void) => React.JSX.Element][] = [
  [
    'Palette',
    (close) => (
      <Palette
        mode="search"
        brain={[]}
        search={async () => []}
        types={[]}
        projects={[]}
        onPickTask={() => undefined}
        onCreate={async () => null}
        onCommand={() => undefined}
        onClose={close}
      />
    )
  ],
  [
    'ShortcutDialog',
    (close) => <ShortcutDialog bindings={{}} onBind={() => undefined} onClose={close} />
  ],
  ['ProjectDialog', (close) => <ProjectDialog onCreate={async () => null} onClose={close} />],
  [
    'IconPicker',
    (close) => <IconPicker value="icon:check" onPick={() => undefined} onClose={close} />
  ]
]

for (const [name, make] of MODALS) {
  it(`${name}: modal, Tab preso, Esc fecha uma vez e o foco volta a quem abriu`, () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    let closed = 0
    let open = true
    const close = (): void => {
      closed++
      open = false
      draw()
    }
    const draw = (): void => act(() => root.render(open ? make(close) : <></>))
    draw()
    const box = host.querySelector('[role="dialog"]') as HTMLElement
    expect(box.getAttribute('aria-modal')).toBe('true')
    expect(box.contains(document.activeElement)).toBe(true)
    // do primeiro, Shift+Tab vai ao último e Tab volta ao primeiro, sem sair da caixa
    const all = [
      ...box.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
    ].filter((el) => el.tabIndex >= 0)
    all[0].focus()
    key('Tab', true)
    expect(box.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(all[all.length - 1])
    key('Tab')
    expect(document.activeElement).toBe(all[0])
    key('Escape')
    expect(closed).toBe(1)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
}
