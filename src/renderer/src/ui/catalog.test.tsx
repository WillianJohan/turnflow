// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
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

it('Ajustes abre a aba Design system', () => {
  window.turnflow = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'fonts') return async () => ({ ok: true, data: { all: [], mono: [] } })
        return async () => ({ ok: true, data: [] })
      }
    }
  ) as unknown as Window['turnflow']
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
  act(() => root.render(<SettingsView cfg={cfg} onChange={() => undefined} />))
  const tab = [...host.querySelectorAll('[role="tab"]')].find(
    (button) => button.textContent === 'Design system'
  )
  act(() => (tab as HTMLButtonElement | undefined)?.click())
  expect(host.querySelector('[data-scheme="dark"] [data-component="Button"]')).not.toBeNull()
  expect(host.querySelector('[data-scheme="light"] [data-component="Button"]')).not.toBeNull()
})
