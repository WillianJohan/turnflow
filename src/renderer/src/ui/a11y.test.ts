import { readFileSync } from 'fs'
import { expect, it } from 'vitest'
import { MIN_TARGET } from './metrics'

it('todo alvo tem pelo menos 24 px', () => {
  expect(MIN_TARGET).toBe(24)
  const css = readFileSync(new URL('./ui.css', import.meta.url), 'utf8')
  expect(css).toMatch(/\.ui-target\s*\{[^}]*min-height:\s*24px/)
  expect(css).toMatch(/\.ui-target\s*\{[^}]*min-width:\s*24px/)
  expect(css).toMatch(/\.ui-target:focus-visible\s*\{[^}]*outline:\s*2px/)
})

// Reduzir movimento é conferido no app real (e2e/ds.spec.ts): media query não roda no jsdom.
