// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { BUILTIN_THEMES } from '../../../shared/theme/builtins'
import type { ConfigState } from '../../../shared/types'
import { SettingsView } from '../SettingsView'
import { Catalog } from './catalog'
import { MIN_COMPONENTS } from './minimal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

it('a aba mostra os 20 componentes do conjunto mínimo no claro e no escuro', () => {
  expect(MIN_COMPONENTS).toHaveLength(20)
  act(() => root.render(<Catalog />))
  for (const name of MIN_COMPONENTS) {
    expect(host.querySelector(`[data-scheme="dark"] [data-component="${name}"]`)).not.toBeNull()
    expect(host.querySelector(`[data-scheme="light"] [data-component="${name}"]`)).not.toBeNull()
  }
})

it('prévia escura é o tema padrão (escuro), cada prévia com o próprio color-scheme', () => {
  act(() => root.render(<Catalog />))
  const dark = host.querySelector<HTMLElement>('[data-scheme="dark"]')!
  const light = host.querySelector<HTMLElement>('[data-scheme="light"]')!
  expect(dark.style.getPropertyValue('--bg')).toBe(BUILTIN_THEMES.escuro.ui.bg)
  expect(light.style.getPropertyValue('--bg')).toBe(BUILTIN_THEMES.claro.ui.bg)
  expect(dark.style.getPropertyValue('color-scheme')).toBe('dark')
  expect(light.style.getPropertyValue('color-scheme')).toBe('light')
})

it('Ajustes: abas com tabpanel, aria-controls, tabstop único e setas', async () => {
  mockApi()
  act(() => root.render(<SettingsView cfg={cfg} onChange={() => undefined} />))
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1])
  for (const tab of tabs) {
    const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '')
    if (tab.getAttribute('aria-selected') === 'true') {
      expect(panel?.getAttribute('role')).toBe('tabpanel')
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id)
    }
  }
  act(() => tabs[0].focus())
  const press = (key: string): void =>
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      )
    })
  press('ArrowRight')
  expect(document.activeElement).toBe(tabs[1])
  expect(tabs[1].getAttribute('aria-selected')).toBe('true')
  expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0])
  await act(async () => await new Promise((r) => setTimeout(r, 0)))
  const panel = document.getElementById(tabs[1].getAttribute('aria-controls') ?? '')
  expect(panel?.querySelector('[data-scheme="dark"] [data-component="Button"]')).not.toBeNull()
  press('ArrowRight')
  expect(document.activeElement).toBe(tabs[0])
  press('End')
  expect(document.activeElement).toBe(tabs[1])
  press('Home')
  expect(document.activeElement).toBe(tabs[0])
})

function mockApi(): void {
  window.turnflow = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'fonts') return async () => ({ ok: true, data: { all: [], mono: [] } })
        return async () => ({ ok: true, data: [] })
      }
    }
  ) as unknown as Window['turnflow']
}

const cfg: ConfigState = {
  dir: '/tmp/turnflow',
  config: {
    theme: 'escuro',
    draftMode: false,
    notifications: true,
    fontSize: 13,
    termFont: 'JetBrains Mono',
    appFont: 'system-ui',
    appFontSize: 13,
    statusIcons: {},
    defaultWorkdir: null,
    brainDir: null,
    agents: { codex: 'codex', cursor: 'cursor-agent', other: null }
  },
  theme: { name: 'Escuro', ui: {}, terminal: {} },
  themes: []
}

it('Ajustes abre a aba Design system', async () => {
  mockApi()
  act(() => root.render(<SettingsView cfg={cfg} onChange={() => undefined} />))
  const tab = [...host.querySelectorAll('[role="tab"]')].find(
    (button) => button.textContent === 'Design system'
  )
  act(() => (tab as HTMLButtonElement | undefined)?.click())
  // o catálogo é carregado sob demanda
  await act(async () => await new Promise((r) => setTimeout(r, 0)))
  expect(host.querySelector('[data-scheme="dark"] [data-component="Button"]')).not.toBeNull()
  expect(host.querySelector('[data-scheme="light"] [data-component="Button"]')).not.toBeNull()
})
