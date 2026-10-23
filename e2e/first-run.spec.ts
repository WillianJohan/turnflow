import type { Page } from '@playwright/test'
import { existsSync } from 'fs'
import { join } from 'path'
import { expect, test } from './helpers'

const PASSWORD = 'senha-certa-14'

async function setPassword(page: Page, pw = PASSWORD): Promise<void> {
  await page.getByTestId('pw-new').fill(pw)
  await page.getByTestId('pw-confirm').fill(pw)
  await page.getByTestId('pw-submit').click()
}

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

test('basic_text: senha, palavras, locked, senha errada, desbloquear', async ({ launch }) => {
  let { app, page } = await launch('basic_text')

  await expect(page.getByTestId('pw-new')).toBeVisible()
  await page.getByTestId('pw-new').fill('a'.repeat(11))
  await page.getByTestId('pw-confirm').fill('a'.repeat(11))
  await expect(page.getByTestId('pw-submit')).toBeDisabled()
  await expect(page.getByText('A senha precisa de pelo menos 12 caracteres')).toBeVisible()

  await setPassword(page)
  await readWords(page)
  await expect(page.getByTestId('words-continue')).toBeDisabled()
  await confirmWords(page)
  await app.close()

  ;({ app, page } = await launch('basic_text'))
  await expect(page.getByTestId('unlock-password')).toBeVisible()
  await expect(page.getByTestId('app-shell')).toHaveCount(0)

  await page.getByTestId('unlock-password').fill('senha-errada-14')
  await page.getByTestId('unlock-submit').click()
  await expect(page.getByTestId('unlock-error')).toContainText('Senha incorreta')
  await expect(page.getByTestId('app-shell')).toHaveCount(0)

  await page.getByTestId('unlock-password').fill(PASSWORD)
  await page.getByTestId('unlock-submit').click()
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await app.close()
})

test('fechar antes do Continuar volta a ser primeiro uso', async ({ dir, launch }) => {
  let { app, page } = await launch('basic_text')
  await setPassword(page)
  await readWords(page)
  await app.close()

  expect(existsSync(join(dir, 'key.enc'))).toBe(false)

  ;({ app, page } = await launch('basic_text'))
  await expect(page.getByTestId('pw-new')).toBeVisible()
  await app.close()
})

test('usar chave de recuperação desbloqueia', async ({ launch }) => {
  let { app, page } = await launch('basic_text')
  await setPassword(page)
  const words = await readWords(page)
  await confirmWords(page)
  await app.close()

  ;({ app, page } = await launch('basic_text'))
  await page.getByTestId('unlock-recover-link').click()
  await page.getByTestId('recover-words').fill(words.join(' '))
  await page.getByTestId('recover-pw-new').fill('outra-senha-nova')
  await page.getByTestId('recover-pw-confirm').fill('outra-senha-nova')
  await page.getByTestId('recover-submit').click()
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await app.close()
})

test('keyring real não pede senha', async ({ launch }) => {
  let { app, page } = await launch('real')
  await readWords(page)
  await expect(page.getByTestId('pw-new')).toHaveCount(0)
  await confirmWords(page)
  await app.close()

  ;({ app, page } = await launch('real'))
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await expect(page.getByTestId('unlock-password')).toHaveCount(0)
  await app.close()
})

test('palavras copiadas saem do clipboard no Continuar', async ({ launch }) => {
  const { app, page } = await launch('basic_text')
  const clipboard = (): Promise<string> => app.evaluate(({ clipboard }) => clipboard.readText())
  await setPassword(page)
  const words = await readWords(page)
  await page.getByTestId('words-copy').click()
  await expect.poll(clipboard).toBe(words.join(' '))
  await confirmWords(page)
  // Vazio no Xvfb; no GNOME/Wayland, soltar o clipboard faz o mutter devolver uma seleção antiga.
  // O que importa nos dois: as palavras saíram.
  await expect.poll(clipboard).not.toBe(words.join(' '))
  await app.close()
})
