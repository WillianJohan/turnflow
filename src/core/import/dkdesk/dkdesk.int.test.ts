import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { AppConfig, Theme } from '../../../shared/types'
import { tmpDir } from '../../testing/db'
import { nodeBrainFs } from '../markdown/scan'
import { applyDkdesk } from './apply'
import { planDkdesk, type DkdeskPlan } from './plan'
import { readDkdesk, type DkdeskSource } from './read'

const DEFAULTS: AppConfig = {
  theme: 'escuro',
  draftMode: false,
  notifications: true,
  fontSize: 13,
  termFont: 'JetBrains Mono',
  appFont: 'system-ui',
  appFontSize: 13,
  statusIcons: {},
  defaultWorkdir: null,
  brainDir: null
}
const BUILTIN: Record<string, Theme> = {
  escuro: { name: 'Dark', ui: { bg: '#14161a' }, terminal: { background: '#14161a' } }
}

/** Pasta de origem sintética: config, temas e lixo que nunca deve ser aberto. */
function makeSource(): string {
  const dir = tmpDir()
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ theme: 'night', fontSize: 11, termFont: 'Fira Code', statusIcons: { A: 'b' } })
  )
  mkdirSync(join(dir, 'themes'))
  writeFileSync(
    join(dir, 'themes', 'night.json'),
    JSON.stringify({
      name: 'Night',
      ui: { bg: '#0a0a14', accent: '#ff00aa' },
      terminal: { background: '#0a0a14' }
    })
  )
  writeFileSync(join(dir, 'themes', 'broken.json'), '{ nope')
  mkdirSync(join(dir, 'Local Storage', 'leveldb'), { recursive: true })
  writeFileSync(join(dir, 'Local Storage', 'leveldb', 'x.ldb'), 'secret-ish')
  writeFileSync(join(dir, 'windowPrefs.json'), '{"x":1}')
  return dir
}

/** Destino cru: `themes/*.json` lidos como estão, sem mesclar com o padrão. */
function readDstThemes(themesDir: string): { id: string; json: unknown | null }[] {
  return readdirSync(themesDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      id: f.slice(0, -5),
      json: JSON.parse(readFileSync(join(themesDir, f), 'utf8'))
    }))
}

const plan = async (
  srcDir: string,
  themesDir: string,
  config: Record<string, unknown> = { ...DEFAULTS }
): Promise<{ src: DkdeskSource; plan: DkdeskPlan }> => {
  const src = await readDkdesk(srcDir)
  return {
    src,
    plan: planDkdesk(src, {
      config,
      themes: readDstThemes(themesDir),
      builtin: BUILTIN,
      defaults: DEFAULTS
    })
  }
}

function hashTree(dir: string): string {
  const h = createHash('sha256')
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n)
      h.update(p)
      if (statSync(p).isDirectory()) walk(p)
      else h.update(readFileSync(p))
    }
  }
  walk(dir)
  return h.digest('hex')
}

const newDst = (): {
  themesDir: string
  writeConfig: Mock<(p: Partial<AppConfig>) => Promise<void>>
} => {
  const themesDir = join(tmpDir(), 'themes')
  mkdirSync(themesDir)
  return {
    themesDir,
    writeConfig: vi.fn<(p: Partial<AppConfig>) => Promise<void>>(async () => undefined)
  }
}

describe('import do app legado', () => {
  it('só config.json e themes/*.json são abertos', async () => {
    const dir = makeSource()
    const read: string[] = []
    const fs = {
      ...nodeBrainFs,
      readFile: (p: string, m?: number) => (read.push(p), nodeBrainFs.readFile(p, m))
    }
    await readDkdesk(dir, fs)
    expect(read.sort()).toEqual(
      [
        join(dir, 'config.json'),
        join(dir, 'themes', 'broken.json'),
        join(dir, 'themes', 'night.json')
      ].sort()
    )
  })

  it('tema criado tem base', async () => {
    const dst = newDst()
    const { src, plan: p } = await plan(makeSource(), dst.themesDir)
    const r = await applyDkdesk(p, src, dst)
    expect(r.themes_created).toBe(1)
    const file = JSON.parse(readFileSync(join(dst.themesDir, 'night.json'), 'utf8'))
    expect(file).toEqual({
      name: 'Night',
      ui: { bg: '#0a0a14', accent: '#ff00aa' },
      terminal: { background: '#0a0a14' },
      base: { scheme: 'dark', bg: '#0a0a14', accent: '#ff00aa', ai: '#ff00aa' }
    })
    expect(dst.writeConfig).toHaveBeenCalledWith({
      theme: 'night',
      fontSize: 11,
      termFont: 'Fira Code'
    })
    expect(r.config_keys.sort()).toEqual(['fontSize', 'termFont', 'theme'])
  })

  it('importar duas vezes não duplica', async () => {
    const dir = makeSource()
    const dst = newDst()
    const first = await plan(dir, dst.themesDir)
    await applyDkdesk(first.plan, first.src, dst)
    const before = readdirSync(dst.themesDir)
    const cfg = { ...DEFAULTS, theme: 'night', fontSize: 11, termFont: 'Fira Code' }
    const second = await plan(dir, dst.themesDir, cfg)
    expect(second.plan.themes.every((t) => t.action.startsWith('skip_'))).toBe(true)
    expect(second.plan.config).toEqual({})
    dst.writeConfig.mockClear()
    const r = await applyDkdesk(second.plan, second.src, dst)
    expect(r).toEqual({ themes_created: 0, config_keys: [], skipped: [] })
    expect(readdirSync(dst.themesDir)).toEqual(before)
    expect(dst.writeConfig).not.toHaveBeenCalled()
  })

  it('nunca sobrescreve', async () => {
    const dst = newDst()
    const { src, plan: p } = await plan(makeSource(), dst.themesDir)
    writeFileSync(join(dst.themesDir, 'night.json'), '{"mine":true}')
    const r = await applyDkdesk(p, src, dst)
    expect(readFileSync(join(dst.themesDir, 'night.json'), 'utf8')).toBe('{"mine":true}')
    expect(r.skipped).toEqual(['night'])
    expect(r.themes_created).toBe(0)
    // o tema não entrou: config.theme não pode apontar para um arquivo que não é o dela
    expect(dst.writeConfig).toHaveBeenCalledWith({ fontSize: 11, termFont: 'Fira Code' })
  })

  it('origem ausente: NOT_FOUND legacy_not_found', async () => {
    const err = await readDkdesk(join(tmpDir(), 'nope')).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'NOT_FOUND', details: { reason: 'legacy_not_found' } })
  })

  it('origem intacta', async () => {
    const dir = makeSource()
    const before = hashTree(dir)
    const dst = newDst()
    const { src, plan: p } = await plan(dir, dst.themesDir)
    await applyDkdesk(p, src, dst)
    expect(hashTree(dir)).toBe(before)
  })
})
