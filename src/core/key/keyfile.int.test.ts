import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VaultError, type VaultErrorCode } from './errors'
import {
  KDF_DEFAULT,
  readKeyFile,
  unlockDek,
  wrapWithKeyring,
  wrapWithPassword,
  writeKeyFile
} from './keyfile'
import { dekToWords } from './recovery'
import { fakeKeyBackend } from '../testing/fakeKeyBackend'
import { tmpDir } from '../testing/db'

const FAST = { m: 1024, t: 1 }
const PASSWORD = 'senha-correta-123'

async function rejectsWith(p: Promise<unknown>, code: VaultErrorCode): Promise<void> {
  await expect(p).rejects.toSatisfy((e) => e instanceof VaultError && e.code === code)
}

function codeOf(fn: () => unknown): VaultErrorCode | undefined {
  try {
    fn()
  } catch (e) {
    if (e instanceof VaultError) return e.code
    throw e
  }
  return undefined
}

describe('key.enc', () => {
  it('senha: ida e volta pelo disco', async () => {
    const dek = randomBytes(32)
    const file = join(tmpDir(), 'key.enc')
    writeKeyFile(file, await wrapWithPassword(dek, PASSWORD, FAST))
    const kf = readKeyFile(file)
    expect(kf?.mode).toBe('password')
    expect((await unlockDek(kf!, { password: PASSWORD })).equals(dek)).toBe(true)
  })

  it('senha errada → WRONG_PASSWORD', async () => {
    const kf = await wrapWithPassword(randomBytes(32), PASSWORD, FAST)
    await rejectsWith(unlockDek(kf, { password: 'senha-errada-1234' }), 'WRONG_PASSWORD')
  })

  it('parâmetro adulterado no arquivo invalida a tag (AAD)', async () => {
    const file = join(tmpDir(), 'key.enc')
    writeKeyFile(file, await wrapWithPassword(randomBytes(32), PASSWORD, { m: 1024, t: 2 }))
    const json = JSON.parse(readFileSync(file, 'utf8'))
    json.kdf.t = 1
    writeFileSync(file, JSON.stringify(json))
    await rejectsWith(unlockDek(readKeyFile(file)!, { password: PASSWORD }), 'WRONG_PASSWORD')
  })

  it('NFC: senha composta abre o arquivo criado com a decomposta', async () => {
    const dek = randomBytes(32)
    const decomposed = 'café-café-café'
    const composed = decomposed.normalize('NFC')
    expect(composed).not.toBe(decomposed)
    const kf = await wrapWithPassword(dek, decomposed, FAST)
    expect((await unlockDek(kf, { password: composed })).equals(dek)).toBe(true)
  })

  it('PASSWORD_TOO_SHORT com 11 code points (e 12 passa)', async () => {
    await rejectsWith(wrapWithPassword(randomBytes(32), 'ç'.repeat(11), FAST), 'PASSWORD_TOO_SHORT')
    // 11 caracteres compostos viram 22 code points decompostos; depois do NFC continuam 11.
    await rejectsWith(wrapWithPassword(randomBytes(32), 'ç'.repeat(11), FAST), 'PASSWORD_TOO_SHORT')
    await expect(wrapWithPassword(randomBytes(32), 'ç'.repeat(12), FAST)).resolves.toBeDefined()
  })

  it('keyring: ida e volta com backend real', async () => {
    const dek = randomBytes(32)
    const backend = fakeKeyBackend('real')
    const file = join(tmpDir(), 'key.enc')
    writeKeyFile(file, wrapWithKeyring(dek, backend))
    const kf = readKeyFile(file)!
    expect(kf.mode).toBe('keyring')
    expect((await unlockDek(kf, { keyring: backend })).equals(dek)).toBe(true)
  })

  it('keyring quebrado → KEYRING_UNAVAILABLE', async () => {
    const kf = wrapWithKeyring(randomBytes(32), fakeKeyBackend('real'))
    await rejectsWith(
      unlockDek(kf, { keyring: fakeKeyBackend('real', { broken: true }) }),
      'KEYRING_UNAVAILABLE'
    )
    const short = { ...fakeKeyBackend('real'), decrypt: () => Buffer.alloc(16) }
    await rejectsWith(unlockDek(kf, { keyring: short }), 'KEYRING_UNAVAILABLE')
  })

  it('palavras destravam qualquer modo', async () => {
    const dek = randomBytes(32)
    const words = dekToWords(dek).join(' ')
    const byPassword = await wrapWithPassword(dek, PASSWORD, FAST)
    const byKeyring = wrapWithKeyring(dek, fakeKeyBackend('real'))
    expect((await unlockDek(byPassword, { words })).equals(dek)).toBe(true)
    expect((await unlockDek(byKeyring, { words })).equals(dek)).toBe(true)
  })

  it('credencial que não casa com o modo → BAD_STATE', async () => {
    const dek = randomBytes(32)
    const byPassword = await wrapWithPassword(dek, PASSWORD, FAST)
    const byKeyring = wrapWithKeyring(dek, fakeKeyBackend('real'))
    await rejectsWith(unlockDek(byPassword, { keyring: fakeKeyBackend('real') }), 'BAD_STATE')
    await rejectsWith(unlockDek(byKeyring, { password: PASSWORD }), 'BAD_STATE')
  })

  it('escrita atômica: 0600, sem .tmp depois e .tmp velho sobrescrito', async () => {
    const dir = tmpDir()
    const file = join(dir, 'key.enc')
    writeFileSync(join(dir, 'key.enc.tmp'), 'lixo de um crash anterior', { mode: 0o644 })
    const kf = await wrapWithPassword(randomBytes(32), PASSWORD, FAST)
    writeKeyFile(file, kf)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(existsSync(join(dir, 'key.enc.tmp'))).toBe(false)
    expect(readKeyFile(file)).toEqual(kf)
  })

  it('ausente → null; corrompido → KEYFILE_CORRUPT', () => {
    const dir = tmpDir()
    expect(readKeyFile(join(dir, 'key.enc'))).toBeNull()
    writeFileSync(join(dir, 'key.enc'), '{')
    expect(codeOf(() => readKeyFile(join(dir, 'key.enc')))).toBe('KEYFILE_CORRUPT')
  })

  it('v2 desconhecida ou campo extra → KEYFILE_CORRUPT', async () => {
    const dir = tmpDir()
    const file = join(dir, 'key.enc')
    const kf = await wrapWithPassword(randomBytes(32), PASSWORD, FAST)
    writeFileSync(file, JSON.stringify({ ...kf, v: 2 }))
    expect(codeOf(() => readKeyFile(file))).toBe('KEYFILE_CORRUPT')
    writeFileSync(file, JSON.stringify({ ...kf, extra: 1 }))
    expect(codeOf(() => readKeyFile(file))).toBe('KEYFILE_CORRUPT')
    writeFileSync(file, JSON.stringify({ ...kf, nonce: 'AAAA' }))
    expect(codeOf(() => readKeyFile(file))).toBe('KEYFILE_CORRUPT')
  })

  it('o JSON não contém a DEK (nem hex nem base64)', async () => {
    const dek = randomBytes(32)
    const dir = tmpDir()
    for (const kf of [
      await wrapWithPassword(dek, PASSWORD, FAST),
      wrapWithKeyring(dek, fakeKeyBackend('real'))
    ]) {
      const file = join(dir, `key-${kf.mode}.enc`)
      writeKeyFile(file, kf)
      const raw = readFileSync(file, 'utf8')
      expect(raw).not.toContain(dek.toString('hex'))
      expect(raw).not.toContain(dek.toString('base64'))
      expect(raw).not.toContain(dek.toString('base64url'))
    }
  })

  it('KDF_DEFAULT (64 MiB, t=3) destrava em menos de 5 s', async () => {
    const dek = randomBytes(32)
    const kf = await wrapWithPassword(dek, PASSWORD)
    expect(kf).toMatchObject({ kdf: { alg: 'argon2id', ...KDF_DEFAULT } })
    const t0 = performance.now()
    expect((await unlockDek(kf, { password: PASSWORD })).equals(dek)).toBe(true)
    expect(performance.now() - t0).toBeLessThan(5000)
  }, 20_000)
})
