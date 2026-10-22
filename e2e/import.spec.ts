import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { IMPORT_COPY } from '../src/shared/copy/import'
import type { RendererApi } from '../src/shared/ipc/api'
import type { Page } from '@playwright/test'
import type { TaskDetail } from '../src/shared/contracts'
import { expect, test, type Keyring, type Launched } from './helpers'

const PASSWORD = 'senha-certa-14'
const COPY = IMPORT_COPY.screen

type Launch = (keyring: Keyring) => Promise<Launched>

/** Cópia do brain sintético no tmp do teste, com credencial e anexo que só podem ser listados. */
function syntheticBrain(dir: string): string {
  const brain = join(dir, 'import-brain')
  cpSync(resolve('e2e/fixtures/brain'), brain, { recursive: true })
  mkdirSync(join(brain, 'credentials'))
  writeFileSync(join(brain, 'credentials', 'x.md'), 'not a real secret\n')
  writeFileSync(join(brain, 'tasks', 'current', 'ABC-1', 'notes.txt'), 'attachment\n')
  return brain
}

/** Primeiro uso, Ajustes, e "Browse…" com o diálogo nativo respondendo a pasta do brain. */
async function openImport(launch: Launch, brain: string): Promise<Launched> {
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
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, brain)
  await page.getByTestId('import-browse').click()
  await expect(page.getByTestId('import-root')).toHaveValue(brain)
  return { app, page }
}

/** Detalhe da task pelo IPC do próprio renderer. */
function taskGet(page: Page, key: string): Promise<TaskDetail> {
  return page.evaluate(async (id) => {
    const api = (window as unknown as { turnflow: RendererApi }).turnflow
    const r = await api.taskGet({ id })
    if (!r.ok) throw new Error(r.error.message)
    return r.data
  }, key)
}

test('import do brain: prévia, apply e reimport sem mudança', async ({ dir, launch }) => {
  const brain = syntheticBrain(dir)
  const { app, page } = await openImport(launch, brain)
  await expect(page.getByTestId('import-apply')).toBeDisabled()

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
  const texts = (await taskGet(page, 'ABC-2')).checkpoints.map((c) => c.text)
  expect(texts).toContain(IMPORT_COPY.importedStatus('parked'))

  await page.getByTestId('import-preview').click()
  await expect(page.getByTestId('import-count-unchanged')).toHaveText('3')
  await expect(page.getByTestId('import-count-create')).toHaveText('0')
  await app.close()
})

test('escolhas da tela chegam ao core: etapa escolhida e conflito com o markdown', async ({
  dir,
  launch
}) => {
  const brain = syntheticBrain(dir)
  const { app, page } = await openImport(launch, brain)
  await page.getByTestId('import-preview').click()

  // status sem mapeamento -> 2ª etapa do fluxo (opção 0 é "Not mapped", 1 é a 1ª etapa)
  const parked = page.getByTestId('import-status-parked')
  const second = (await parked.locator('option').nth(2).textContent())!.trim()
  await parked.selectOption({ label: second })
  await expect(parked.locator('option:checked')).toHaveText(second)
  await page.getByTestId('import-apply').click()
  await expect(page.getByTestId('import-report-created')).toHaveText('3')
  const abc2 = await taskGet(page, 'ABC-2')
  expect(abc2.stage.name).toBe(second)
  expect(abc2.checkpoints.map((c) => c.text)).not.toContain(IMPORT_COPY.importedStatus('parked'))

  // título editado no app e no markdown: conflito; "Use markdown" grava o valor do markdown
  const abc1 = await taskGet(page, 'ABC-1')
  await page.evaluate(async (id) => {
    const api = (window as unknown as { turnflow: RendererApi }).turnflow
    const r = await api.taskUpdate({ id, patch: { title: 'Edited in the app' } })
    if (!r.ok) throw new Error(r.error.message)
  }, abc1.id)
  const readme = join(brain, 'tasks', 'current', 'ABC-1', 'README.md')
  writeFileSync(
    readme,
    readFileSync(readme, 'utf8').replace(
      'Write the onboarding guide',
      'Write the contributor guide'
    )
  )
  await page.getByTestId('import-preview').click()
  const row = page.getByTestId('import-task-ABC-1')
  await expect(row.locator('input[value=app]')).toBeChecked()
  await row.locator('input[value=markdown]').check()
  await page.getByTestId('import-apply').click()
  await expect(page.getByTestId('import-report')).toContainText(COPY.takenMarkdown(1))
  expect((await taskGet(page, 'ABC-1')).title).toBe('Write the contributor guide')
  await app.close()
})
