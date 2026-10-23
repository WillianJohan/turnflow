import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalLog } from './localLog'
import { tmpDir } from '../core/testing/db'

describe('createLocalLog', () => {
  it('anexa linhas com timestamp ISO, criando o diretório', () => {
    const file = join(tmpDir(), 'logs', 'app.log')
    const log = createLocalLog(file)
    log('um')
    log('dois')
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z um$/)
    expect(lines[1]).toMatch(/ dois$/)
  })

  it('passou de maxBytes: rotaciona para .1 e o novo começa com a linha', () => {
    const file = join(tmpDir(), 'app.log')
    const log = createLocalLog(file, 100)
    log('a'.repeat(60))
    log('b'.repeat(60))
    expect(existsSync(`${file}.1`)).toBe(true)
    expect(readFileSync(`${file}.1`, 'utf8')).toContain('a'.repeat(60))
    const now = readFileSync(file, 'utf8').trim().split('\n')
    expect(now).toHaveLength(1)
    expect(now[0]).toContain('b'.repeat(60))
  })

  it('nunca lança (diretório impossível)', () => {
    const base = join(tmpDir(), 'arquivo')
    writeFileSync(base, '')
    const log = createLocalLog(join(base, 'sub', 'app.log'))
    expect(() => log('x')).not.toThrow()
  })
})
