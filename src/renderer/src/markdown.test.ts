// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { renderMd } from './markdown'

it('renderiza título, lista de critérios e código', () => {
  const html = renderMd('# T-1 — x\n\n## Critérios\n- [x] feito\n- [ ] falta\n\n`a.ts:12`')
  expect(html).toContain('<h1')
  expect(html).toContain('type="checkbox"')
  expect(html).toContain('<code>a.ts:12</code>')
})
it('remove script e handler de evento (README é texto do brain, não do app)', () => {
  const html = renderMd('<img src=x onerror="alert(1)"><script>alert(2)</script>')
  expect(html).not.toContain('onerror')
  expect(html).not.toContain('<script')
})
it('link externo abre fora (target _blank)', () => {
  expect(renderMd('[gitlab](https://gitlab.com/x)')).toContain('target="_blank"')
})
