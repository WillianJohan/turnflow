import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DomainError } from '../../domain/errors'
import { tmpDir } from '../../testing/db'
import { readStatusMap, writeStatusMap, type StatusMapFile } from './statusMap'

const EMPTY: StatusMapFile = { version: 1, entries: {} }

describe('status-map.json', () => {
  it('arquivo ausente = vazio, sem problema', async () => {
    const r = await readStatusMap(join(tmpDir(), 'nope.json'))
    expect(r).toEqual({ map: EMPTY, dropped: 0 })
  })

  it('ilegivel ou fora do formato = vazio com problema', async () => {
    const f = join(tmpDir(), 'bad.json')
    for (const [body, problem] of [
      ['{ nao e json', 'unreadable'],
      ['[]', 'invalid'],
      ['{"version":"x","entries":{}}', 'invalid'],
      ['{"version":1,"entries":[]}', 'invalid'],
      ['{"version":2,"entries":{}}', 'newer_version']
    ] as const) {
      writeFileSync(f, body)
      expect(await readStatusMap(f)).toEqual({ map: EMPTY, problem, dropped: 0 })
    }
  })

  it('aproveita entrada por entrada e conta as invalidas', async () => {
    const f = join(tmpDir(), 'm.json')
    writeFileSync(
      f,
      JSON.stringify({
        version: 1,
        entries: {
          ' Em Teste ': { role: 'review' },
          ruim: { role: 'nada' },
          dois: { role: 'first', stage: 'A' },
          '': { role: 'first' },
          weird: { stage: 'Doing' }
        }
      })
    )
    const r = await readStatusMap(f)
    expect(r.map.entries).toEqual({ 'em teste': { role: 'review' }, weird: { stage: 'Doing' } })
    expect(r.dropped).toBe(3)
    expect(r.problem).toBeUndefined()
  })

  it('write e read devolvem o mesmo objeto, criando o diretorio pai', async () => {
    const dir = tmpDir()
    const file = join(dir, 'sub', 'deep', 'status-map.json')
    const m: StatusMapFile = {
      version: 1,
      entries: { 'em teste': { role: 'review' }, weird: { stage: 'Doing' } }
    }
    await writeStatusMap(file, m)
    expect((await readStatusMap(file)).map).toEqual(m)
    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(m, null, 2))
    expect(statSync(join(dir, 'sub')).mode & 0o077).toBe(0)
  })

  it('write nao deixa .tmp para tras', async () => {
    const dir = tmpDir()
    const file = join(dir, 'status-map.json')
    await writeStatusMap(file, EMPTY)
    await writeStatusMap(file, EMPTY)
    expect(readdirSync(dir)).toEqual(['status-map.json'])
  })

  it('rename que falha limpa o .tmp', async () => {
    const dir = tmpDir()
    const file = join(dir, 'status-map.json')
    mkdirSync(file) // rename de arquivo sobre diretorio falha
    await expect(writeStatusMap(file, EMPTY)).rejects.toThrow()
    expect(readdirSync(dir)).toEqual(['status-map.json'])
  })

  it('arquivo existente ilegivel vai para .bak, e o segundo ganha sufixo unico', async () => {
    const dir = tmpDir()
    const file = join(dir, 'status-map.json')
    writeFileSync(file, 'lixo 1')
    await writeStatusMap(file, EMPTY)
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe('lixo 1')
    writeFileSync(file, '[]')
    await writeStatusMap(file, EMPTY)
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe('lixo 1')
    const baks = readdirSync(dir).filter((n) => n.includes('.bak'))
    expect(baks).toHaveLength(2)
    expect(existsSync(file)).toBe(true)
    expect((await readStatusMap(file)).problem).toBeUndefined()
  })

  it('arquivo de versao mais nova: recusa e nao toca', async () => {
    const dir = tmpDir()
    const file = join(dir, 'status-map.json')
    writeFileSync(file, '{"version":2,"entries":{}}')
    await expect(writeStatusMap(file, EMPTY)).rejects.toBeInstanceOf(DomainError)
    expect(readFileSync(file, 'utf8')).toBe('{"version":2,"entries":{}}')
    expect(readdirSync(dir)).toEqual(['status-map.json'])
  })

  it('arquivo com entradas invalidas e preservado em .bak antes de sobrescrever', async () => {
    const dir = tmpDir()
    const file = join(dir, 'status-map.json')
    const body = '{"version":1,"entries":{"a":{"role":"nada"},"b":{"role":"first"}}}'
    writeFileSync(file, body)
    await writeStatusMap(file, EMPTY)
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe(body)
  })
})
