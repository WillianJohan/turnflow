import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { readUi, writeUi } from './uiStore'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tf-ui-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const file = {
  version: 1 as const,
  layout: { panels: [{ tabs: ['T-1'], active: 0 }], focused: 0 },
  sidebar: { folded: false, width: 288 },
  home: 'list' as const,
  fab: { edge: 'right' as const, offset: 24 },
  density: 'normal' as const,
  shortcuts: {}
}

it('arquivo ausente ou quebrado lê null', async () => {
  expect(await readUi(dir)).toBeNull()
  writeFileSync(join(dir, 'ui.json'), '{ quebrado')
  expect(await readUi(dir)).toBeNull()
})

it('grava e relê o ui.json', async () => {
  await writeUi(dir, file)
  expect(await readUi(dir)).toEqual(file)
  expect(readFileSync(join(dir, 'ui.json'), 'utf8').endsWith('\n')).toBe(true)
})
