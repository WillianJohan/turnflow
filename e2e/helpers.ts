import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export type Keyring = 'basic_text' | 'real'

/** Pasta de configuração isolada para um teste (some com o tmp do SO). */
export const tempConfigDir = (): string => mkdtempSync(join(tmpdir(), 'tf-e2e-'))

/** Abre o build de teste com config, brain e chaveiro falso isolados. */
export async function launch(
  dir: string,
  keyring: Keyring
): Promise<{ app: ElectronApplication; page: Page }> {
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
      TURNFLOW_TEST_KEYRING: keyring,
      TURNFLOW_BRAIN: brain
    }
  })
  const page = await app.firstWindow()
  return { app, page }
}
