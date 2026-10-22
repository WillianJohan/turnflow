import { expect, test, type Page } from '@playwright/test'
import { existsSync } from 'fs'
import { join } from 'path'
import { launch, tempConfigDir } from './helpers'

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

test('basic_text: senha, palavras, locked, senha errada, desbloquear', async () => {
  const dir = tempConfigDir()
  let { app, page } = await launch(dir, 'basic_text')

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

  ;({ app, page } = await launch(dir, 'basic_text'))
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

test('fechar antes do Continuar volta a ser primeiro uso', async () => {
  const dir = tempConfigDir()
  let { app, page } = await launch(dir, 'basic_text')
  await setPassword(page)
  await readWords(page)
  await app.close()

  expect(existsSync(join(dir, 'key.enc'))).toBe(false)

  ;({ app, page } = await launch(dir, 'basic_text'))
  await expect(page.getByTestId('pw-new')).toBeVisible()
  await app.close()
})

test('usar chave de recuperação desbloqueia', async () => {
  const dir = tempConfigDir()
  let { app, page } = await launch(dir, 'basic_text')
  await setPassword(page)
  const words = await readWords(page)
  await confirmWords(page)
  await app.close()

  ;({ app, page } = await launch(dir, 'basic_text'))
  await page.getByTestId('unlock-recover-link').click()
  await page.getByTestId('recover-words').fill(words.join(' '))
  await page.getByTestId('recover-pw-new').fill('outra-senha-nova')
  await page.getByTestId('recover-pw-confirm').fill('outra-senha-nova')
  await page.getByTestId('recover-submit').click()
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await app.close()
})

test('keyring real não pede senha', async () => {
  const dir = tempConfigDir()
  let { app, page } = await launch(dir, 'real')
  await readWords(page)
  await expect(page.getByTestId('pw-new')).toHaveCount(0)
  await confirmWords(page)
  await app.close()

  ;({ app, page } = await launch(dir, 'real'))
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await expect(page.getByTestId('unlock-password')).toHaveCount(0)
  await app.close()
})
