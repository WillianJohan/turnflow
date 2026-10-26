// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IMPORT_COPY } from '../../../../shared/copy/import'
import { ExportMarkdown } from './ExportMarkdown'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => act(() => root.render(<></>)))

let pick: ReturnType<typeof vi.fn>
let exp: ReturnType<typeof vi.fn>
beforeEach(() => {
  pick = vi.fn(async () => ({ ok: true, data: { path: '/some/dest' } }))
  exp = vi.fn(async () => ({ ok: true, data: { dir: '/some/dest/x', tasks: 3 } }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).turnflow = { importPickFolder: pick, exportMarkdown: exp }
})

const byTest = <T extends Element>(id: string): T =>
  host.querySelector(`[data-testid="${id}"]`) as T
const click = (id: string): Promise<void> => act(async () => byTest<HTMLButtonElement>(id).click())

it('escolhe a pasta, exporta e mostra onde ficou', async () => {
  await act(async () => root.render(<ExportMarkdown />))
  expect(byTest('export-run').textContent).toBe(IMPORT_COPY.export.button)
  await click('export-run')
  expect(exp).toHaveBeenCalledWith({ dest: '/some/dest' })
  expect(byTest('export-done').textContent).toBe(IMPORT_COPY.export.done(3, '/some/dest/x'))
})

it('seletor cancelado não exporta; erro aparece', async () => {
  await act(async () => root.render(<ExportMarkdown />))
  pick.mockResolvedValueOnce({ ok: true, data: { path: null } })
  await click('export-run')
  expect(exp).not.toHaveBeenCalled()
  exp.mockResolvedValueOnce({ ok: false, error: { code: 'VALIDATION', message: 'bad dest' } })
  await click('export-run')
  expect(byTest('export-error').textContent).toBe('bad dest')
})
