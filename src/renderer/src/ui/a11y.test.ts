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

it('reduzir movimento zera toast, painel e FAB', () => {
  const css = readFileSync(new URL('../assets/main.css', import.meta.url), 'utf8')
  const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)
  expect(block?.[0]).toContain('.toast')
  expect(block?.[0]).toContain('.panel')
  expect(block?.[0]).toContain('.fab')
  expect(block?.[0]).toMatch(/animation-duration:\s*0s/)
  expect(block?.[0]).toMatch(/transition-duration:\s*0s/)
})
