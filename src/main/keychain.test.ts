import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../core/db/open'
import { VaultError, type VaultErrorCode } from '../core/key/errors'
import { vaultPaths } from '../core/key/paths'
import { createVault, type Vault } from '../core/key/vault'
import { tmpDir } from '../core/testing/db'
import { fakeKeyBackend } from '../core/testing/fakeKeyBackend'
import { safeStorageBackend, selectKeyBackend } from './keychain'

// Espia o openDb que o vault usa: senha errada não pode abrir handle nenhum do SQLite.
vi.mock('../core/db/open', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../core/db/open')>()
  return { ...mod, openDb: vi.fn(mod.openDb) }
})

// safeStorage falso: "cifra" invertendo a string, para provar a conversão hex no adaptador.
const fakeSafeStorage = (
  o: { available?: boolean; selected?: string } = {}
): Parameters<typeof safeStorageBackend>[0] & object => ({
  isEncryptionAvailable: () => o.available ?? true,
  encryptString: (s: string) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decryptString: (b: Buffer) => [...b.toString('utf8')].reverse().join(''),
  ...(o.selected === undefined ? {} : { getSelectedStorageBackend: () => o.selected as string })
})

const electronSafeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => false),
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8')
}))
vi.mock('electron', () => ({ safeStorage: electronSafeStorage }))

const PASSWORD = 'senha-correta-123'

async function rejectsWith(p: Promise<unknown>, code: VaultErrorCode): Promise<void> {
  await expect(p).rejects.toSatisfy((e) => e instanceof VaultError && e.code === code)
}

function basicTextVault(dir: string): Vault {
  return createVault({ paths: vaultPaths(dir), backend: fakeKeyBackend('basic_text') })
}

async function firstRunWithPassword(dir: string): Promise<string[]> {
  const v = basicTextVault(dir)
  await v.boot()
  const { words } = await v.beginFirstRun(PASSWORD)
  await v.commitFirstRun()
  v.close()
  return words
}

describe('vault com senha mestra (basic_text)', () => {
  beforeEach(() => {
    vi.mocked(openDb).mockClear()
  })

  it('basic_text exige senha', async () => {
    const v = basicTextVault(tmpDir())
    expect(await v.boot()).toBe('first_run')
    expect(v.backend()).toBe('basic_text')
    await rejectsWith(v.beginFirstRun(), 'PASSWORD_REQUIRED')
    await rejectsWith(v.beginFirstRun(''), 'PASSWORD_REQUIRED')
    await rejectsWith(v.beginFirstRun('curta-11-ch'), 'PASSWORD_TOO_SHORT')
    expect(v.pendingWords()).toBeNull()
  })

  it('senha errada mantém locked e não abre o banco', async () => {
    const dir = tmpDir()
    await firstRunWithPassword(dir)
    vi.mocked(openDb).mockClear()
    const v = basicTextVault(dir)
    expect(await v.boot()).toBe('locked')
    expect(v.lockReason()).toBe('password')
    await rejectsWith(v.unlockWithPassword('errada-errada-errada'), 'WRONG_PASSWORD')
    expect(v.state()).toBe('locked')
    expect(() => v.db()).toThrow(expect.objectContaining({ code: 'LOCKED' }))
    expect(openDb).not.toHaveBeenCalled()
    await v.unlockWithPassword(PASSWORD)
    expect(v.state()).toBe('ready')
    expect(openDb).toHaveBeenCalledTimes(1)
    v.close()
  }, 20_000)

  it('chave de recuperação abre', async () => {
    const dir = tmpDir()
    const words = await firstRunWithPassword(dir)
    const v = basicTextVault(dir)
    await v.boot()
    await v.recover(words.join(' '), 'senha-nova-123')
    expect(v.state()).toBe('ready')
    v.close()
    const next = basicTextVault(dir)
    expect(await next.boot()).toBe('locked')
    await rejectsWith(next.unlockWithPassword(PASSWORD), 'WRONG_PASSWORD')
    await next.unlockWithPassword('senha-nova-123')
    expect(next.state()).toBe('ready')
    next.close()
  }, 30_000)
})

describe('safeStorageBackend', () => {
  it('kind() conforme o safeStorage e a plataforma', () => {
    expect(safeStorageBackend(fakeSafeStorage({ selected: 'basic_text' }), 'linux').kind()).toBe(
      'basic_text'
    )
    expect(
      safeStorageBackend(fakeSafeStorage({ selected: 'gnome_libsecret' }), 'linux').kind()
    ).toBe('real')
    expect(safeStorageBackend(fakeSafeStorage({ available: false }), 'linux').kind()).toBe(
      'basic_text'
    )
    expect(safeStorageBackend(fakeSafeStorage({ available: false }), 'darwin').kind()).toBe(
      'basic_text'
    )
    expect(safeStorageBackend(fakeSafeStorage(), 'darwin').kind()).toBe('real')
  })

  it('ida e volta encrypt/decrypt com a DEK de 32 bytes (hex por dentro)', () => {
    const ss = fakeSafeStorage({ selected: 'gnome_libsecret' })
    const encrypt = vi.spyOn(ss, 'encryptString')
    const backend = safeStorageBackend(ss, 'linux')
    const dek = randomBytes(32)
    const blob = backend.encrypt(dek)
    expect(encrypt).toHaveBeenCalledWith(dek.toString('hex'))
    expect(backend.decrypt(blob).equals(dek)).toBe(true)
  })

  it('decrypt que não devolve hex lança', () => {
    const ss = { ...fakeSafeStorage(), decryptString: () => 'não-é-hex' }
    expect(() => safeStorageBackend(ss, 'linux').decrypt(Buffer.from('x'))).toThrow()
  })
})

describe('selectKeyBackend', () => {
  it('TURNFLOW_TEST_KEYRING escolhe o backend de teste', async () => {
    expect((await selectKeyBackend({ TURNFLOW_TEST_KEYRING: 'basic_text' })).kind()).toBe(
      'basic_text'
    )
    const real = await selectKeyBackend({ TURNFLOW_TEST_KEYRING: 'real' })
    expect(real.kind()).toBe('real')
    const dek = randomBytes(32)
    expect(real.decrypt(real.encrypt(dek)).equals(dek)).toBe(true)
  })

  it('valor desconhecido de TURNFLOW_TEST_KEYRING lança', async () => {
    await expect(selectKeyBackend({ TURNFLOW_TEST_KEYRING: 'kwallet' })).rejects.toThrow()
  })

  it('sem a env usa o safeStorage do electron', async () => {
    const backend = await selectKeyBackend({})
    expect(electronSafeStorage.isEncryptionAvailable).not.toHaveBeenCalled()
    expect(backend.kind()).toBe('basic_text')
    expect(electronSafeStorage.isEncryptionAvailable).toHaveBeenCalled()
    const dek = randomBytes(32)
    expect(backend.decrypt(backend.encrypt(dek)).equals(dek)).toBe(true)
  })
})
