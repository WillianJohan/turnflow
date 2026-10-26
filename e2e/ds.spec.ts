import type { Locator, Page } from '@playwright/test'
import type { RendererApi } from '../src/shared/ipc/api'
import { expect, test } from './helpers'

// Design system mínimo (E6.6) no app real: cor da tag, movimento reduzido, menu ⋯ da task, modais
// com foco preso e devolvido, divisória da lateral por teclado e a aba Design system.

const PASSWORD = 'senha-certa-14'
const ENV = (dir: string): Record<string, string> => ({
  HOME: dir,
  TURNFLOW_TEST_NOW: '2026-10-22T12:00:00.000Z'
})

async function firstRun(page: Page): Promise<void> {
  await page.getByTestId('pw-new').fill(PASSWORD)
  await page.getByTestId('pw-confirm').fill(PASSWORD)
  await page.getByTestId('pw-submit').click()
  await expect(page.getByTestId('words-list').locator('li')).toHaveCount(24)
  await page.getByTestId('words-saved').check()
  await page.getByTestId('words-continue').click()
  await expect(page.getByTestId('app-shell')).toBeVisible()
}

async function createTask(page: Page, title: string, block = false): Promise<string> {
  return page.evaluate(
    async ([t, b]) => {
      const api = (window as unknown as { turnflow: RendererApi }).turnflow
      const created = await api.taskCreate({ title: t as string })
      if (!created.ok || !created.data.row) throw new Error('task')
      const id = created.data.row.id
      if (b) {
        const blocked = await api.taskBlock({ id, reason: 'waiting on review' })
        if (!blocked.ok) throw new Error('block')
      }
      return id
    },
    [title, block] as const
  )
}

/** Foco continua dentro de `box` depois de `n` Tabs (e de `n` Shift+Tabs). */
async function trapped(page: Page, box: Locator, n = 8): Promise<void> {
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < n; i++) {
      await page.keyboard.press(key)
      expect(await box.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    }
  }
}

const inside = (el: Element): boolean => el.contains(document.activeElement)

test('Bloq. no Início usa o vermelho do tema', async ({ dir, launch }) => {
  const { app, page } = await launch('basic_text', dir, ENV(dir))
  await firstRun(page)
  await createTask(page, 'Stuck task', true)
  const tag = page
    .locator('.home li', { hasText: 'Stuck task' })
    .getByText('Bloq.', { exact: true })
  await expect(tag).toBeVisible()
  const [got, red] = await tag.evaluate((el) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--red)'
    document.body.appendChild(probe)
    const want = getComputedStyle(probe).color
    probe.remove()
    return [getComputedStyle(el).color, want]
  })
  expect(got).toBe(red)
  await app.close()
})

test('reduzir movimento tira a animação do que anima de verdade', async ({ dir, launch }) => {
  const { app, page } = await launch('basic_text', dir, ENV(dir))
  await firstRun(page)
  // as classes reais que animam: ponto de IA trabalhando, cursor do logo, zona de soltar aba
  const probe = (): Promise<{ dot: string; cursor: string; zone: string; running: number }> =>
    page.evaluate(async () => {
      const add = (cls: string): HTMLElement => {
        const el = document.createElement('span')
        el.className = cls
        document.getElementById('root')?.appendChild(el)
        return el
      }
      const dot = add('dot working')
      const zone = add('dropzone left')
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const cursor = document.querySelector('.logo-cursor')
      const out = {
        dot: getComputedStyle(dot).animationDuration,
        cursor: cursor ? getComputedStyle(cursor).animationDuration : 'missing',
        zone: getComputedStyle(zone).transitionDuration,
        running: document.getAnimations().length
      }
      dot.remove()
      zone.remove()
      return out
    })
  const normal = await probe()
  expect(normal.dot).toBe('1.2s')
  expect(normal.running).toBeGreaterThan(0)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduced = await probe()
  expect(reduced).toEqual({ dot: '0s', cursor: '0s', zone: '0s', running: 0 })
  await app.close()
})

test('menu ⋯ da task anda por teclado, fecha com Esc e por clique fora', async ({
  dir,
  launch
}) => {
  const { app, page } = await launch('basic_text', dir, ENV(dir))
  await firstRun(page)
  await createTask(page, 'Menu task')
  await page.locator('.home button', { hasText: 'Menu task' }).click()
  const trigger = page.getByRole('button', { name: 'Task menu' })
  await expect(trigger).toBeVisible()

  await trigger.focus()
  await page.keyboard.press('Enter')
  const items = page.getByRole('menuitem')
  await expect(items.first()).toBeFocused()
  await expect(items.first()).toHaveText('Record')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Sessions' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(items.last()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(items.first()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(items.first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  // ↑ no gatilho abre no último
  await page.keyboard.press('ArrowUp')
  await expect(items.last()).toBeFocused()
  await page.keyboard.press('Escape')

  await trigger.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.locator('.th-title').click()
  await expect(page.getByRole('menu')).toHaveCount(0)

  // escolher pelo teclado roda a ação e fecha
  await trigger.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.locator('.timeline-filter [aria-pressed="true"]')).toHaveText('Sessions')
  await app.close()
})

test('modais prendem o Tab e devolvem o foco a quem abriu', async ({ dir, launch }) => {
  const { app, page } = await launch('basic_text', dir, ENV(dir))
  await firstRun(page)
  const settings = page.locator('#sidebar button[title^="Settings"]').first()

  // paleta
  await settings.focus()
  await page.keyboard.press('Control+Shift+K')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(page.getByRole('combobox')).toBeFocused()
  await trapped(page, palette, 3)
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
  await expect(settings).toBeFocused()

  // atalhos
  await page.keyboard.press('Control+Shift+K')
  await page.getByRole('combobox').fill('> Shortcuts')
  await page.keyboard.press('Enter')
  const shortcuts = page.getByRole('dialog', { name: 'Shortcuts' })
  await expect(shortcuts).toBeVisible()
  expect(await shortcuts.evaluate(inside)).toBe(true)
  await trapped(page, shortcuts, 40)
  await page.keyboard.press('Escape')
  await expect(shortcuts).toHaveCount(0)
  await expect(settings).toBeFocused()

  // projeto (+ Novo > Project)
  await page.keyboard.press('Control+Shift+N')
  await page.getByRole('menuitem', { name: /Project/ }).click()
  const project = page.getByRole('dialog', { name: 'New project' })
  await expect(project.getByRole('textbox')).toBeFocused()
  await trapped(page, project, 5)
  await page.keyboard.press('Escape')
  await expect(project).toHaveCount(0)

  // seletor de ícone em Ajustes
  await settings.click()
  const iconButton = page.locator('.icon-btn').first()
  await iconButton.click()
  const picker = page.getByRole('dialog', { name: 'Choose icon' })
  await expect(picker.getByRole('textbox')).toBeFocused()
  await trapped(page, picker, 6)
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(iconButton).toBeFocused()
  await app.close()
})

test('divisória da lateral muda a largura pelas setas', async ({ dir, launch }) => {
  const { app, page } = await launch('basic_text', dir, ENV(dir))
  await firstRun(page)
  const handle = page.locator('#sidebar [role="separator"]')
  const sidebar = page.locator('#sidebar')
  await handle.focus()
  await expect(handle).toBeFocused()
  const before = Number(await handle.getAttribute('aria-valuenow'))
  expect(await handle.getAttribute('aria-valuemin')).toBe('220')
  expect(await handle.getAttribute('aria-valuemax')).toBe('440')
  await page.keyboard.press('ArrowRight')
  await expect(handle).toHaveAttribute('aria-valuenow', String(before + 16))
  expect(await sidebar.evaluate((el) => (el as HTMLElement).style.width)).toBe(`${before + 16}px`)
  await page.keyboard.press('Home')
  await expect(handle).toHaveAttribute('aria-valuenow', '220')
  // a área de clique tem 24 px mesmo com o traço fino
  expect(Math.round((await handle.boundingBox())?.width ?? 0)).toBeGreaterThanOrEqual(24)
  await app.close()
})

test('Ajustes: abas por seta e a aba Design system com prévias isoladas', async ({
  dir,
  launch
}) => {
  const { app, page } = await launch('basic_text', dir, ENV(dir))
  await firstRun(page)
  await page.locator('#sidebar button[title^="Settings"]').first().click()
  const tabs = page.locator('.settings-page [role="tablist"]')
  const first = tabs.getByRole('tab', { name: 'Settings' })
  const design = tabs.getByRole('tab', { name: 'Design system' })
  await first.focus()
  await page.keyboard.press('ArrowRight')
  await expect(design).toBeFocused()
  await expect(design).toHaveAttribute('aria-selected', 'true')
  const panelId = await design.getAttribute('aria-controls')
  expect(panelId).toBeTruthy()
  const panel = page.locator(`[role="tabpanel"][id="${panelId}"]`)
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-scheme="dark"] [data-component="Button"]')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(first).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(design).toBeFocused()

  const schemes = await panel
    .locator('.ds-preview')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).colorScheme))
  expect(schemes).toEqual(['dark', 'light'])

  // o toast de amostra fica dentro da própria prévia
  for (const scheme of ['dark', 'light']) {
    const preview = panel.locator(`[data-scheme="${scheme}"]`)
    const box = await preview.boundingBox()
    const toast = await preview.locator('.toast').boundingBox()
    expect(box && toast).toBeTruthy()
    if (!box || !toast) continue
    expect(toast.y).toBeGreaterThanOrEqual(box.y)
    expect(toast.y + toast.height).toBeLessThanOrEqual(box.y + box.height)
  }

  // todo alvo do catálogo tem pelo menos 24 px
  const small = await panel.locator('.ui-target').evaluateAll((els) =>
    els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && (r.width < 24 || r.height < 24))
      .map((r) => `${r.width}x${r.height}`)
  )
  expect(small).toEqual([])

  // tooltip: escondido até o hover/foco, ligado por aria-describedby
  const tipTarget = panel.locator(
    '[data-scheme="dark"] [data-component="Tooltip"] [aria-describedby]'
  )
  const tipId = await tipTarget.getAttribute('aria-describedby')
  const bubble = page.locator(`[id="${tipId}"]`)
  await expect(bubble).toBeHidden()
  await tipTarget.hover()
  await expect(bubble).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(bubble).toBeHidden()
  await tipTarget.focus()
  await expect(bubble).toBeVisible()
  await app.close()
})
