import { cpSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { IMPORT_COPY } from '../src/shared/copy/import'
import type { RendererApi } from '../src/shared/ipc/api'
import { expect, test } from './helpers'

const PASSWORD = 'senha-certa-14'
const COPY = IMPORT_COPY.screen

test('import do brain: prévia, apply e reimport sem mudança', async ({ dir, launch }) => {
  // Cópia do brain sintético no tmp do teste, com credencial e anexo que só podem ser listados.
  const brain = join(dir, 'import-brain')
  cpSync(resolve('e2e/fixtures/brain'), brain, { recursive: true })
  mkdirSync(join(brain, 'credentials'))
  writeFileSync(join(brain, 'credentials', 'x.md'), 'not a real secret\n')
  writeFileSync(join(brain, 'tasks', 'current', 'ABC-1', 'notes.txt'), 'attachment\n')

  const { app, page } = await launch('basic_text')
  await page.getByTestId('pw-new').fill(PASSWORD)
  await page.getByTestId('pw-confirm').fill(PASSWORD)
  await page.getByTestId('pw-submit').click()
  await expect(page.getByTestId('words-list').locator('li')).toHaveCount(24)
  await page.getByTestId('words-saved').check()
  await page.getByTestId('words-continue').click()
  await expect(page.getByTestId('app-shell')).toBeVisible()

  await page.getByTitle('Configurações: tema e fonte').click()
  await expect(page.getByTestId('settings-import')).toBeVisible()
  await expect(page.getByTestId('import-apply')).toBeDisabled()

  // "Browse…" com o diálogo nativo respondendo a pasta do brain
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, brain)
  await page.getByTestId('import-browse').click()
  await expect(page.getByTestId('import-root')).toHaveValue(brain)

  await page.getByTestId('import-preview').click()
  await expect(page.getByTestId('import-count-create')).toHaveText('3')
  for (const key of ['ABC-1', 'ABC-2', 'ABC-3'])
    await expect(page.getByTestId(`import-action-${key}`)).toHaveText(COPY.actions.create)
  // status sem mapeamento, com a etapa editável
  const parked = page.getByTestId('import-status-parked')
  await expect(parked.locator('option:checked')).toHaveText(COPY.notMapped)
  await expect(parked).toBeEnabled()
  await expect(page.getByTestId('import-attachments')).toContainText('notes.txt')
  await expect(page.getByTestId('import-ignored')).toContainText('credentials')

  await page.getByTestId('import-apply').click()
  await expect(page.getByTestId('import-report-created')).toHaveText('3')

  const keys = await page.evaluate(async () => {
    const api = (window as unknown as { turnflow: RendererApi }).turnflow
    const r = await api.taskList({ scope: 'attention' })
    return r.ok ? r.data.map((t) => t.key).sort() : r.error.message
  })
  expect(keys).toEqual(['ABC-1', 'ABC-2'])
  // status sem mapeamento vira checkpoint na task
  const texts = await page.evaluate(async () => {
    const api = (window as unknown as { turnflow: RendererApi }).turnflow
    const r = await api.taskGet({ id: 'ABC-2' })
    return r.ok ? r.data.checkpoints.map((c) => c.text) : [r.error.message]
  })
  expect(texts).toContain(IMPORT_COPY.importedStatus('parked'))

  await page.getByTestId('import-preview').click()
  await expect(page.getByTestId('import-count-unchanged')).toHaveText('3')
  await expect(page.getByTestId('import-count-create')).toHaveText('0')
  await app.close()
})
