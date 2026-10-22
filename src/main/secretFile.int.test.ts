import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tmpDir } from '../core/testing/db'
import { writeSecretFile } from './secretFile'

const mode = (f: string): number => statSync(f).mode & 0o777

describe('writeSecretFile', () => {
  it('arquivo novo nasce 0600', async () => {
    const f = join(tmpDir(), 'novo.txt')
    await writeSecretFile(f, 'conteúdo')
    expect(mode(f)).toBe(0o600)
    expect(readFileSync(f, 'utf8')).toBe('conteúdo')
  })
  it('arquivo pré-existente 0644 vira 0600 e é truncado', async () => {
    const f = join(tmpDir(), 'velho.txt')
    writeFileSync(f, 'texto antigo bem mais comprido')
    chmodSync(f, 0o644)
    await writeSecretFile(f, 'novo')
    expect(mode(f)).toBe(0o600)
    expect(readFileSync(f, 'utf8')).toBe('novo')
  })
})
