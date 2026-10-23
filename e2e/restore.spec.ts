import { existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { expect, test } from './helpers'

const PASSWORD = 'senha-certa-14'

test('restaurar backup numa instalação limpa: palavra errada não escreve nada, certa abre', async ({
  dir,
  launch
}) => {
  // Instalação A: primeiro uso; o backup do dia sai na entrada em ready.
  let { app, page } = await launch('basic_text')
  await page.getByTestId('pw-new').fill(PASSWORD)
  await page.getByTestId('pw-confirm').fill(PASSWORD)
  await page.getByTestId('pw-submit').click()
  const items = page.getByTestId('words-list').locator('li')
  await expect(items).toHaveCount(24)
  const words = (await items.allTextContents()).map((w) => w.trim())
  await page.getByTestId('words-saved').check()
  await page.getByTestId('words-continue').click()
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await app.close()
  const daily = readdirSync(join(dir, 'backups')).find((n) => /-\d{8}\.db$/.test(n))
  expect(daily).toBeDefined()
  const backup = join(dir, 'backups', daily as string)

  // Instalação B, limpa, com o diálogo de abrir respondendo o backup de A.
  const b = join(dir, 'b')
  mkdirSync(b)
  ;({ app, page } = await launch('basic_text', b))
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, backup)
  await page.getByTestId('restore-link').click()
  await page.getByTestId('restore-pick').click()
  await expect(page.getByTestId('restore-file')).toContainText(daily as string)
  const wrong = [...words]
  wrong[4] = 'xyzzy'
  await page.getByTestId('restore-words').fill(wrong.join(' '))
  await page.getByTestId('restore-pw-new').fill('outra-senha-nova')
  await page.getByTestId('restore-pw-confirm').fill('outra-senha-nova')
  await page.getByTestId('restore-submit').click()
  await expect(page.getByTestId('restore-error')).toContainText('A palavra 5 não existe na lista')
  expect(existsSync(join(b, 'key.enc'))).toBe(false)
  expect(existsSync(join(b, 'turnflow.db.init'))).toBe(false)

  await page.getByTestId('restore-words').fill(words.join(' '))
  await page.getByTestId('restore-submit').click()
  await expect(page.getByTestId('app-shell')).toBeVisible()
  expect(existsSync(join(b, 'key.enc'))).toBe(true)
  await app.close()

  // B abre com a senha nova
  ;({ app, page } = await launch('basic_text', b))
  await page.getByTestId('unlock-password').fill('outra-senha-nova')
  await page.getByTestId('unlock-submit').click()
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await app.close()
})
