import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tmpDir } from '../../testing/db'
import { readStatusMap, writeStatusMap, type StatusMapFile } from './statusMap'

const EMPTY: StatusMapFile = { version: 1, entries: {} }

describe('status-map.json', () => {
  it('arquivo ausente ou invalido = vazio', async () => {
    const dir = tmpDir()
    expect(await readStatusMap(join(dir, 'nope.json'))).toEqual(EMPTY)
    const bad = join(dir, 'bad.json')
    for (const body of [
      '{ nao e json',
      '[]',
      '{"version":2,"entries":{}}',
      '{"version":1,"entries":{"x":{"role":"nada"}}}',
      '{"version":1,"entries":{"x":{"role":"first","stage":"A"}}}'
    ]) {
      writeFileSync(bad, body)
      expect(await readStatusMap(bad)).toEqual(EMPTY)
    }
  })

  it('write e read devolvem o mesmo objeto', async () => {
    const dir = tmpDir()
    const file = join(dir, 'sub', 'status-map.json')
    mkdirSync(join(dir, 'sub'))
    const m: StatusMapFile = {
      version: 1,
      entries: { 'em teste': { role: 'review' }, weird: { stage: 'Doing' } }
    }
    await writeStatusMap(file, m)
    expect(await readStatusMap(file)).toEqual(m)
    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(m, null, 2))
  })

  it('write nao deixa .tmp para tras', async () => {
    const dir = tmpDir()
    const file = join(dir, 'status-map.json')
    await writeStatusMap(file, EMPTY)
    await writeStatusMap(file, EMPTY)
    expect(readdirSync(dir)).toEqual(['status-map.json'])
  })
})
