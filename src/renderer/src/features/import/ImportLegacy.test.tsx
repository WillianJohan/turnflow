// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IMPORT_COPY } from '../../../../shared/copy/import'
import type { LegacyPlan } from '../../../../shared/ipc/import'
import { ImportLegacy } from './ImportLegacy'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

const plan = (token: string): LegacyPlan => ({
  token,
  themes: [
    { from: 'night', to: 'night', name: 'Night', action: 'create' },
    { from: 'escuro', to: null, name: 'Old dark', action: 'skip_builtin' }
  ],
  config: { termFont: 'Fira Code' },
  ignored_keys: ['zoom']
})

let dry: ReturnType<typeof vi.fn>
let apply: ReturnType<typeof vi.fn>
beforeEach(() => {
  let n = 0
  dry = vi.fn(async () => ({ ok: true, data: plan(`t${++n}`) }))
  apply = vi.fn(async () => ({
    ok: true,
    data: { themes_created: 1, config_keys: ['termFont'], skipped: [] }
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).turnflow = { importLegacyDryRun: dry, importLegacyApply: apply }
})

const byTest = <T extends Element>(id: string): T =>
  host.querySelector(`[data-testid="${id}"]`) as T
const click = (id: string): Promise<void> => act(async () => byTest<HTMLButtonElement>(id).click())

it('prévia em lista, Apply manda o token da prévia e mostra o resultado', async () => {
  await act(async () => root.render(<ImportLegacy />))
  expect(byTest('legacy-preview').textContent).toBe(IMPORT_COPY.legacy.button)
  expect(byTest('legacy-apply')).toBeNull()
  await click('legacy-preview')
  expect(byTest('legacy-plan').textContent).toContain('Night')
  expect(byTest('legacy-plan').textContent).toContain(IMPORT_COPY.legacy.actions.skip_builtin)
  await click('legacy-apply')
  expect(apply).toHaveBeenCalledWith({ token: 't1' })
  expect(byTest('legacy-done').textContent).toBe(IMPORT_COPY.legacy.done(1, 1))
})

it('preview_stale refaz a prévia e avisa; origem ausente mostra o erro', async () => {
  await act(async () => root.render(<ImportLegacy />))
  await click('legacy-preview')
  apply.mockResolvedValueOnce({
    ok: false,
    error: { code: 'CONFLICT', message: 'x', details: { reason: 'preview_stale' } }
  })
  await click('legacy-apply')
  expect(dry).toHaveBeenCalledTimes(2)
  expect(byTest('legacy-notice').textContent).toBe(IMPORT_COPY.legacy.previewRefreshed)
  dry.mockResolvedValueOnce({
    ok: false,
    error: { code: 'NOT_FOUND', message: IMPORT_COPY.errors.legacy_not_found }
  })
  await click('legacy-preview')
  expect(byTest('legacy-error').textContent).toBe(IMPORT_COPY.errors.legacy_not_found)
  expect(byTest('legacy-plan')).toBeNull()
})
