import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
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

it('ui.json de outra versão ou quebrado vira backup antes de qualquer gravação', async () => {
  const future = JSON.stringify({ version: 2, layout: { panels: [], focused: 0 }, extra: 1 })
  writeFileSync(join(dir, 'ui.json'), future)
  expect(await readUi(dir)).toBeNull()
  await writeUi(dir, file)
  const backups = readdirSync(dir).filter((n) => n.startsWith('ui.json.') && n.endsWith('.bak'))
  expect(backups).toHaveLength(1)
  expect(readFileSync(join(dir, backups[0]), 'utf8')).toBe(future)
})

it('um peso de painel inválido não trava a gravação do resto', async () => {
  const bad = {
    ...file,
    layout: {
      panels: [
        { tabs: ['T-1'], active: 0, size: 0 },
        { tabs: ['T-2'], active: 0, size: -3 }
      ],
      focused: 0
    }
  }
  await writeUi(dir, bad)
  const back = await readUi(dir)
  expect(back?.layout.panels.map((p) => p.tabs)).toEqual([['T-1'], ['T-2']])
  expect(back?.layout.panels.every((p) => p.size === undefined)).toBe(true)
})
