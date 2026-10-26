import type { Page } from '@playwright/test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { RendererApi } from '../src/shared/ipc/api'
import { expect, test } from './helpers'

// Tela nova (E6.1–E6.5) com o app real: task do domínio abrindo pelos três caminhos e voltando do
// ui.json, remap de atalho e setas na lista de atenção da lateral.

const PASSWORD = 'senha-certa-14'
const NOW = '2026-10-22T12:00:00.000Z'

async function firstRun(page: Page): Promise<void> {
  await page.getByTestId('pw-new').fill(PASSWORD)
  await page.getByTestId('pw-confirm').fill(PASSWORD)
  await page.getByTestId('pw-submit').click()
  await expect(page.getByTestId('words-list').locator('li')).toHaveCount(24)
  await page.getByTestId('words-saved').check()
  await page.getByTestId('words-continue').click()
  await expect(page.getByTestId('app-shell')).toBeVisible()
}

async function unlock(page: Page): Promise<void> {
  await page.getByTestId('unlock-password').fill(PASSWORD)
  await page.getByTestId('unlock-submit').click()
  await expect(page.getByTestId('app-shell')).toBeVisible()
}

async function createTasks(page: Page, titles: string[]): Promise<string[]> {
  return page.evaluate(async (all) => {
    const api = (window as unknown as { turnflow: RendererApi }).turnflow
    const ids: string[] = []
    for (const title of all) {
      const created = await api.taskCreate({ title })
      if (!created.ok || !created.data.row) throw new Error('task')
      ids.push(created.data.row.id)
    }
    return ids
  }, titles)
}

type UiJson = { layout: { panels: { tabs: string[] }[] }; shortcuts: Record<string, string> }
const readUi = (dir: string): UiJson | null => {
  const path = join(dir, 'ui.json')
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as UiJson) : null
}
const savedTabs = (dir: string): string[] => readUi(dir)?.layout.panels.flatMap((p) => p.tabs) ?? []

const ENV = (dir: string): Record<string, string> => ({ HOME: dir, TURNFLOW_TEST_NOW: NOW })

test('task do domínio abre pela lateral, pelo Início e pela paleta, e volta do ui.json', async ({
  dir,
  launch
}) => {
  let { app, page } = await launch('basic_text', dir, ENV(dir))
  await firstRun(page)
  const ids = await createTasks(page, ['Alpha task', 'Beta task', 'Gamma task'])

  // Início (sem painel aberto o Início ocupa a tela)
  await page.locator('.home button', { hasText: 'Beta task' }).click()
  await expect(page.locator('.task-head')).toContainText('Beta task')
  await expect(page.locator('.notice')).toHaveCount(0)

  // lateral
  await page.locator('#sidebar [role="option"]', { hasText: 'Alpha task' }).click()
  await expect(page.locator('.task-head')).toContainText('Alpha task')

  // paleta: Enter abre a task achada, não cria outra
  await page.keyboard.press('Control+Shift+K')
  // Enter logo depois de digitar: a busca ainda está no ar e mesmo assim abre a existente
  await page.getByRole('combobox').fill('Gamma')
  await page.keyboard.press('Enter')
  await expect(page.locator('.task-head')).toContainText('Gamma task')
  const count = await page.evaluate(async () => {
    const api = (window as unknown as { turnflow: RendererApi }).turnflow
    const rows = await api.taskList({ scope: 'attention' })
    return rows.ok ? rows.data.length : -1
  })
  expect(count).toBe(3)

  await expect.poll(() => savedTabs(dir).sort()).toEqual([...ids].sort())
  await app.close()

  // reabrir: as abas de domínio sobrevivem ao restore
  ;({ app, page } = await launch('basic_text', dir, ENV(dir)))
  await unlock(page)
  await expect(page.locator('[role="tab"]', { hasText: 'Gamma task' })).toBeVisible()
  await expect(page.locator('[role="tab"]')).toHaveCount(3)
  await expect(page.locator('.task-head')).toContainText('Gamma task')
  expect(savedTabs(dir).sort()).toEqual([...ids].sort())
  await app.close()
})

test('remap de atalho ignora o modificador, grava no ui.json e passa a valer', async ({
  dir,
  launch
}) => {
  const { app, page } = await launch('basic_text', dir, ENV(dir))
  await firstRun(page)

  await page.keyboard.press('Control+Shift+K')
  await page.getByRole('combobox').fill('> Shortcuts')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Shortcuts' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /^Search/ }).click()
  // segura Ctrl+Shift antes da tecla: o keydown do modificador não pode virar o atalho
  await page.keyboard.down('Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyJ')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Control')
  await expect(dialog.getByRole('button', { name: /^Search/ })).toContainText('KeyJ')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()

  await expect.poll(() => readUi(dir)?.shortcuts.search).toBe('KeyJ')
  await page.keyboard.press('Control+Shift+J')
  await expect(page.getByRole('combobox')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+K')
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await app.close()
})

test('setas andam na lista de atenção da lateral sem pular pra outros botões', async ({
  dir,
  launch
}) => {
  const { app, page } = await launch('basic_text', dir, ENV(dir))
  await firstRun(page)
  await createTasks(page, ['One', 'Two', 'Three'])
  const options = page.locator('#sidebar [role="option"]')
  await expect(options).toHaveCount(3)
  await options.first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(options.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(options.nth(2)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(options.nth(1)).toBeFocused()
  // Enter fixa a task do cursor
  const title = (await options.nth(1).textContent()) ?? ''
  await page.keyboard.press('Enter')
  await expect(page.locator('.task-head')).toContainText(title.includes('Two') ? 'Two' : title)
  await app.close()
})
