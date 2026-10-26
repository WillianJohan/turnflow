import type { Page } from '@playwright/test'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { expect, test } from './helpers'

const PASSWORD = 'senha-certa-14'

async function readWords(page: Page): Promise<string[]> {
  const items = page.getByTestId('words-list').locator('li')
  await expect(items).toHaveCount(24)
  return (await items.allTextContents()).map((w) => w.trim())
}

async function confirmWords(page: Page): Promise<void> {
  await page.getByTestId('words-saved').check()
  await page.getByTestId('words-continue').click()
  await expect(page.getByTestId('app-shell')).toBeVisible()
}

/** Só o que é do vault; config.json, electron/ e afins podem existir. */
function vaultLeft(dir: string): string[] {
  const own = ['key.enc', 'turnflow.db', 'backups', 'logs', 'wipe.pending']
  return readdirSync(dir).filter((n) => own.some((o) => n.startsWith(o)))
}

test('esqueci a senha e as palavras: apagar tudo na tela de desbloqueio', async ({
  dir,
  launch
}) => {
  let { app, page } = await launch('basic_text')
  await page.getByTestId('pw-new').fill(PASSWORD)
  await page.getByTestId('pw-confirm').fill(PASSWORD)
  await page.getByTestId('pw-submit').click()
  await readWords(page)
  await confirmWords(page)
  await app.close()
  expect(existsSync(join(dir, 'key.enc'))).toBe(true)

  ;({ app, page } = await launch('basic_text'))
  await page.getByTestId('forgot-link').click()
  const submit = page.getByTestId('wipe-submit')
  await expect(submit).toBeDisabled()
  await page.getByTestId('wipe-input').fill('apagar')
  await expect(submit).toBeDisabled()
  await page.getByTestId('wipe-input').fill('APAGAR')
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(page.getByTestId('pw-new')).toBeVisible()
  expect(vaultLeft(dir)).toEqual([])
  await app.close()

  ;({ app, page } = await launch('basic_text'))
  await expect(page.getByTestId('pw-new')).toBeVisible()
  await app.close()
})

test('keyring real: apagar tudo nos Ajustes volta ao primeiro uso com palavras novas', async ({
  dir,
  launch
}) => {
  const { app, page } = await launch('real')
  const old = await readWords(page)
  await confirmWords(page)

  await page.getByTitle('Settings: theme and font').click()
  const section = page.getByTestId('settings-wipe')
  await section.getByTestId('wipe-input').fill('APAGAR')
  await section.getByTestId('wipe-submit').click()

  await expect(page.getByTestId('app-shell')).toHaveCount(0)
  const fresh = await readWords(page)
  expect(fresh).not.toEqual(old)
  expect(vaultLeft(dir)).toEqual([])
  await app.close()
})
