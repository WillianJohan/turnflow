import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, expect, it } from 'vitest'

// Roda o binário de verdade em modo CLI: precisa de `npm run build` feito e do Electron
// instalado; liga com TURNFLOW_LOCAL=1 (CI não tem display/Electron garantido).
const root = resolve(__dirname, '../..')
const entry = join(root, 'out/main/index.js')
const electron = join(root, 'node_modules/.bin/electron')
const can = !!process.env.TURNFLOW_LOCAL && existsSync(entry) && existsSync(electron)

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cli-home-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

it.skipIf(!can)(
  'modo CLI com HOME falso só escreve dentro do configDir (nada de ~/.config/Electron)',
  () => {
    const cfg = join(home, 'cfg')
    const r = spawnSync(electron, ['--no-sandbox', '--ozone-platform=headless', entry, 'mcp'], {
      input: '',
      timeout: 30000,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        XDG_RUNTIME_DIR: join(home, 'run'),
        TURNFLOW_CONFIG_DIR: cfg
      }
    })
    expect(r.status).toBe(1) // app não está aberto
    const dotConfig = join(home, '.config')
    const outside = existsSync(dotConfig) ? readdirSync(dotConfig) : []
    expect(outside).toEqual([])
    expect(existsSync(join(cfg, 'cli'))).toBe(true)
  }
)
