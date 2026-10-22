import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BRAND } from '../../shared/brand'
import { VAULT_COPY } from '../../shared/copy/vault'
import { dailyName } from '../db/backup'
import { tmpDir } from '../testing/db'
import { fakeKeyBackend } from '../testing/fakeKeyBackend'
import type { KeyBackend } from './backend'
import { VaultError } from './errors'
import { vaultPaths, type VaultPaths } from './paths'
import { createVault, type Vault, type VaultDeps } from './vault'

const PASSWORD = 'senha-correta-123'
const NOW = new Date(2026, 9, 22, 10, 0, 0)
const KEPT = ['config.json', 'ui.json', 'themes', 'bin', 'run', 'electron']

function vaultAt(dir: string, backend: KeyBackend, extra: Partial<VaultDeps> = {}): Vault {
  return createVault({ paths: vaultPaths(dir), backend, now: () => NOW, ...extra })
}

/** Primeiro uso até `ready` no mesmo vault; devolve as palavras. */
async function firstRun(vault: Vault, password?: string): Promise<string[]> {
  expect(await vault.boot()).toBe('first_run')
  const { words } = await vault.beginFirstRun(password)
  await vault.commitFirstRun()
  expect(vault.state()).toBe('ready')
  return words
}

/** O que o usuário tem fora do vault e o wipe precisa manter. */
function seedKept(dir: string): void {
  writeFileSync(join(dir, 'config.json'), '{"theme":"x"}')
  writeFileSync(join(dir, 'ui.json'), '{}')
  for (const d of ['themes', 'bin', 'run', 'electron']) {
    mkdirSync(join(dir, d))
    writeFileSync(join(dir, d, 'f'), 'x')
  }
}

/** Sobras que o wipe apaga além de key.enc e do banco. */
function seedLeftovers(p: VaultPaths): void {
  for (const d of [p.attachments, p.logs, p.restoreTmp]) {
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'x'), 'título de task')
  }
  writeFileSync(p.keyTmp, 'x')
  writeFileSync(p.dbInit, 'x')
  writeFileSync(p.dbInit + '-wal', 'x')
}

function expectWiped(dir: string, p: VaultPaths): void {
  expect(readdirSync(dir).sort()).toEqual([...KEPT].sort())
  for (const f of [p.keyFile, p.db, p.db + '-wal', p.db + '-shm', p.backups, p.wipeMarker])
    expect(existsSync(f)).toBe(false)
  expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe('{"theme":"x"}')
}

describe('apagar tudo', () => {
  it('de ready com backups: só sobra o que não é do vault', async () => {
    const dir = tmpDir()
    const p = vaultPaths(dir)
    seedKept(dir)
    const vault = vaultAt(dir, fakeKeyBackend('real'))
    await firstRun(vault)
    expect(readdirSync(p.backups)).toContain(dailyName(NOW))
    seedLeftovers(p)

    await vault.wipeAll()
    expect(vault.state()).toBe('first_run')
    expect(() => vault.db()).toThrow(VaultError)
    expectWiped(dir, p)

    const fresh = vaultAt(dir, fakeKeyBackend('real'))
    expect(await fresh.boot()).toBe('first_run')
    expect(readdirSync(dir).filter((n) => n.startsWith('backups'))).toEqual([])
    fresh.close()
  })

  it('de locked também', async () => {
    const dir = tmpDir()
    const p = vaultPaths(dir)
    seedKept(dir)
    const backend = fakeKeyBackend('basic_text')
    const a = vaultAt(dir, backend)
    await firstRun(a, PASSWORD)
    a.close()

    const b = vaultAt(dir, backend)
    expect(await b.boot()).toBe('locked')
    await b.wipeAll()
    expect(b.state()).toBe('first_run')
    expect(b.lockReason()).toBeNull()
    expectWiped(dir, p)
    b.close()
  }, 20_000)

  it('de failed também (key.enc sem banco)', async () => {
    const dir = tmpDir()
    const p = vaultPaths(dir)
    seedKept(dir)
    const backend = fakeKeyBackend('real')
    const a = vaultAt(dir, backend)
    await firstRun(a)
    a.close()
    // banco sumido: key.enc fica, o vault vai a failed
    for (const s of ['', '-wal', '-shm']) rmSync(p.db + s, { force: true })

    const b = vaultAt(dir, backend)
    expect(await b.boot()).toBe('failed')
    await b.wipeAll()
    expect(b.state()).toBe('first_run')
    expect(b.failure()).toBeNull()
    expectWiped(dir, p)
    b.close()
  })

  it('wipe interrompido termina no boot e não vira órfão', async () => {
    const dir = tmpDir()
    const p = vaultPaths(dir)
    seedKept(dir)
    writeFileSync(p.wipeMarker, '')
    writeFileSync(p.db, 'banco velho')
    writeFileSync(p.db + '-wal', 'wal velho')
    mkdirSync(p.backups)
    writeFileSync(join(p.backups, 'x.db'), 'backup velho')
    mkdirSync(p.logs)
    writeFileSync(join(p.logs, `${BRAND.id}.log`), 'linha')

    const vault = vaultAt(dir, fakeKeyBackend('real'))
    expect(await vault.boot()).toBe('first_run')
    expectWiped(dir, p)
    vault.close()
  })

  it('no mesmo processo, o primeiro uso depois do wipe gera DEK nova', async () => {
    const dir = tmpDir()
    const backend = fakeKeyBackend('real')
    const vault = vaultAt(dir, backend)
    const old = await firstRun(vault)
    await vault.wipeAll()

    const { words } = await vault.beginFirstRun()
    expect(words).not.toEqual(old)
    await vault.commitFirstRun()
    expect(vault.state()).toBe('ready')
    const backup = join(vaultPaths(dir).backups, dailyName(NOW))
    expect(existsSync(backup)).toBe(true)
    vault.close()

    // as palavras antigas não abrem o backup novo
    const other = vaultAt(tmpDir(), backend)
    expect(await other.boot()).toBe('first_run')
    let err: unknown
    try {
      await other.restore(backup, old.join(' '))
    } catch (e) {
      err = e
    }
    expect((err as VaultError).code).toBe('WRONG_KEY')
    await other.restore(backup, words.join(' '))
    expect(other.state()).toBe('ready')
    other.close()
  }, 20_000)

  // root ignora o 0500 do diretório: o rm não falharia
  it.skipIf(process.getuid?.() === 0)(
    'erro no meio: failed, a chave já foi e o próximo boot termina',
    async () => {
      const dir = tmpDir()
      const p = vaultPaths(dir)
      seedKept(dir)
      const log = vi.fn()
      const vault = vaultAt(dir, fakeKeyBackend('real'), { log })
      await firstRun(vault)
      chmodSync(p.backups, 0o500) // o backup do dia lá dentro não sai
      try {
        let err: unknown
        try {
          await vault.wipeAll()
        } catch (e) {
          err = e
        }
        expect((err as VaultError).code).toBe('OPEN_FAILED')
        expect(vault.state()).toBe('failed')
        expect(vault.failure()?.message).toBe(VAULT_COPY.wipeFailed)
        expect(existsSync(p.keyFile)).toBe(false)
        expect(existsSync(p.wipeMarker)).toBe(true)
        expect(log.mock.calls.map((c) => c[1]).join('\n')).toMatch(/EACCES|EPERM/)
        expect(JSON.stringify(log.mock.calls)).not.toContain(dir)
      } finally {
        chmodSync(p.backups, 0o700)
      }
      expect(await vault.boot()).toBe('first_run')
      expectWiped(dir, p)
      vault.close()
    }
  )

  it('depois do close() o wipe não roda (close é terminal)', async () => {
    const dir = tmpDir()
    const vault = vaultAt(dir, fakeKeyBackend('real'))
    await firstRun(vault)
    vault.close()
    let err: unknown
    try {
      await vault.wipeAll()
    } catch (e) {
      err = e
    }
    expect((err as VaultError).code).toBe('LOCKED')
    expect(existsSync(vaultPaths(dir).keyFile)).toBe(true)
  })
})
