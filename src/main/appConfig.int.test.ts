import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Limits } from '../shared/contracts'
import { tmpDir } from '../core/testing/db'
import { DEFAULT_CONFIG, readConfig, readThemesRaw } from './appConfig'

describe('config.json do disco', () => {
  it('pasta do brain: só caminho absoluto; relativo ou não-texto vira null', async () => {
    expect(DEFAULT_CONFIG.brainDir).toBeNull()
    const d = tmpDir()
    const read = async (v: unknown): Promise<string | null> => {
      await writeFile(join(d, 'config.json'), JSON.stringify({ brainDir: v }))
      return (await readConfig(d)).config.brainDir
    }
    expect(await read('rel')).toBeNull()
    expect(await read(5)).toBeNull()
    expect(await read('')).toBeNull()
    expect(await read('/abs')).toBe('/abs')
    expect(await read('/' + 'a'.repeat(Limits.workdir))).toBeNull()
  })

  it('readThemesRaw não mescla com o padrão', async () => {
    const d = tmpDir()
    await mkdir(join(d, 'themes'))
    await writeFile(join(d, 'themes', 'a.json'), JSON.stringify({ ui: { bg: '#010101' } }))
    await writeFile(join(d, 'themes', 'b.json'), '{ nope')
    await writeFile(join(d, 'themes', 'c.txt'), 'x')
    const r = (await readThemesRaw(d)).sort((x, y) => x.id.localeCompare(y.id))
    expect(r).toEqual([
      { id: 'a', json: { ui: { bg: '#010101' } } },
      { id: 'b', json: null }
    ])
    expect(await readThemesRaw(join(d, 'sem-pasta'))).toEqual([])
  })
})
