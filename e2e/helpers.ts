import { _electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export type Keyring = 'basic_text' | 'real'
export type Launched = { app: ElectronApplication; page: Page }

/** Abre o build de teste com config, socket, brain e chaveiro falso isolados em `dir`. */
export async function launch(dir: string, keyring: Keyring): Promise<Launched> {
  const brain = join(dir, 'brain')
  mkdirSync(brain, { recursive: true })
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.ELECTRON_RENDERER_URL
  const app = await _electron.launch({
    args: ['out-test/main/index.js'],
    env: {
      ...env,
      TURNFLOW_CONFIG_DIR: dir,
      TURNFLOW_SOCKET: join(dir, 's.sock'),
      TURNFLOW_TEST_KEYRING: keyring,
      TURNFLOW_BRAIN: brain
    }
  })
  const page = await app.firstWindow()
  return { app, page }
}

/**
 * `dir`: pasta de configuração do teste, apagada no fim. `launch`: abre o app nela (ou em `at`, uma
 * segunda instalação dentro de `dir`); o que o teste não fechou (falha no meio) é fechado no teardown.
 */
export const test = base.extend<{
  dir: string
  launch: (keyring: Keyring, at?: string) => Promise<Launched>
}>({
  // eslint-disable-next-line no-empty-pattern
  dir: async ({}, provide) => {
    const dir = mkdtempSync(join(tmpdir(), 'tf-e2e-'))
    try {
      await provide(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  launch: async ({ dir }, provide) => {
    const open = new Set<ElectronApplication>()
    try {
      await provide(async (keyring, at = dir) => {
        const l = await launch(at, keyring)
        open.add(l.app)
        l.app.on('close', () => open.delete(l.app))
        return l
      })
    } finally {
      for (const app of open) await app.close().catch(() => undefined)
    }
  }
})

export { expect } from '@playwright/test'
