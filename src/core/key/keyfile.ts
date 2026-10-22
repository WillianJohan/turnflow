import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import { argon2idAsync } from '@noble/hashes/argon2.js'
import { z } from 'zod'
import type { KeyBackend } from './backend'
import { DEK_BYTES } from './dek'
import { VAULT_COPY } from '../../shared/copy/vault'
import { VaultError } from './errors'
import { wordsToDek } from './recovery'

export type KdfParams = { alg: 'argon2id'; m: number; t: number; p: number; salt: string }

/** RFC 9106, 2ª recomendação: 64 MiB, 3 passadas, 1 lane. */
export const KDF_DEFAULT = { m: 65536, t: 3, p: 1 }

const SALT_BYTES = 16
const NONCE_BYTES = 12
const TAG_BYTES = 16
const MIN_PASSWORD_CODE_POINTS = 12

/** Base64 canônico que decodifica em exatamente `n` bytes. */
const b64Of = (n: number): z.ZodType<string> =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .refine((s) => Buffer.from(s, 'base64').length === n && s.length === Math.ceil(n / 3) * 4)

// Teto (256 MiB, t=10, p=8) para um arquivo adulterado não travar o app com um KDF impossível.
// O `wrapWithPassword` valida com o mesmo schema: quem grava não produz o que quem lê recusa.
const KdfParamsZ = z
  .object({
    alg: z.literal('argon2id'),
    m: z.number().int().min(8).max(262_144),
    t: z.number().int().min(1).max(10),
    p: z.number().int().min(1).max(8),
    salt: b64Of(SALT_BYTES)
  })
  .strict()
  .refine((k) => k.m >= 8 * k.p)

export const KeyFileZ = z.discriminatedUnion('mode', [
  z
    .object({
      v: z.literal(1),
      mode: z.literal('keyring'),
      blob: z
        .string()
        .min(1)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      mode: z.literal('password'),
      kdf: KdfParamsZ,
      nonce: b64Of(NONCE_BYTES),
      ct: b64Of(DEK_BYTES),
      tag: b64Of(TAG_BYTES)
    })
    .strict()
])

export type KeyFile =
  | { v: 1; mode: 'keyring'; blob: string }
  | { v: 1; mode: 'password'; kdf: KdfParams; nonce: string; ct: string; tag: string }

export type Credential = { password: string } | { words: string } | { keyring: KeyBackend }

/** Ausente → `null`. JSON ou formato inválido → `KEYFILE_CORRUPT`. */
export function readKeyFile(path: string): KeyFile | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new VaultError('KEYFILE_CORRUPT')
  }
  const parsed = KeyFileZ.safeParse(json)
  if (!parsed.success) throw new VaultError('KEYFILE_CORRUPT')
  return parsed.data
}

/** Escrita atômica: `.tmp` 0600 → fsync → rename → fsync do diretório. */
export function writeKeyFile(path: string, kf: KeyFile): void {
  const tmp = `${path}.tmp`
  rmSync(tmp, { force: true }) // sobra de crash: recria do zero, sem seguir link
  const fd = openSync(tmp, 'wx', 0o600)
  try {
    fchmodSync(fd, 0o600) // o mode do open passa pelo umask
    writeFileSync(fd, JSON.stringify(kf))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
  fsyncDir(dirname(path))
}

function fsyncDir(dir: string): void {
  if (process.platform === 'win32') return // diretório não abre para fsync no Windows
  const fd = openSync(dir, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

// Os parâmetros do KDF entram no AAD: mudar m/t/p no arquivo invalida a tag.
const aadOf = (k: { m: number; t: number; p: number }): Buffer =>
  Buffer.from(`turnflow-key-v1|argon2id|${k.m}|${k.t}|${k.p}`, 'utf8')

async function deriveKek(password: string, k: KdfParams): Promise<Buffer> {
  const pwd = Buffer.from(password.normalize('NFC'), 'utf8')
  try {
    const out = await argon2idAsync(pwd, Buffer.from(k.salt, 'base64'), {
      m: k.m,
      t: k.t,
      p: k.p,
      dkLen: 32
    })
    return Buffer.from(out.buffer, out.byteOffset, out.byteLength)
  } finally {
    pwd.fill(0)
  }
}

function assertDek(dek: Buffer): void {
  if (dek.length !== DEK_BYTES) throw new Error(`DEK precisa de ${DEK_BYTES} bytes`)
}

/** Embrulha a DEK com a senha mestra (Argon2id + AES-256-GCM). */
export async function wrapWithPassword(
  dek: Buffer,
  password: string,
  params?: Partial<typeof KDF_DEFAULT>
): Promise<KeyFile> {
  assertDek(dek)
  if ([...password.normalize('NFC')].length < MIN_PASSWORD_CODE_POINTS)
    throw new VaultError('PASSWORD_TOO_SHORT')
  // Lança (ZodError) se os parâmetros pedidos saírem do que o `readKeyFile` aceita.
  const kdf: KdfParams = KdfParamsZ.parse({
    alg: 'argon2id',
    ...KDF_DEFAULT,
    ...params,
    salt: randomBytes(SALT_BYTES).toString('base64')
  })
  const kek = await deriveKek(password, kdf)
  try {
    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv('aes-256-gcm', kek, nonce, { authTagLength: TAG_BYTES })
    cipher.setAAD(aadOf(kdf))
    const ct = Buffer.concat([cipher.update(dek), cipher.final()])
    return {
      v: 1,
      mode: 'password',
      kdf,
      nonce: nonce.toString('base64'),
      ct: ct.toString('base64'),
      tag: cipher.getAuthTag().toString('base64')
    }
  } finally {
    kek.fill(0)
  }
}

/** Embrulha a DEK no chaveiro do SO. Backend `basic_text` não protege nada: recusado. */
export function wrapWithKeyring(dek: Buffer, backend: KeyBackend): KeyFile {
  assertDek(dek)
  if (backend.kind() !== 'real')
    throw new VaultError('BAD_STATE', { message: VAULT_COPY.badState.keyringNotReal })
  return { v: 1, mode: 'keyring', blob: backend.encrypt(dek).toString('base64') }
}

/** Devolve a DEK. Não confere se ela abre o banco: isso é do vault. */
export async function unlockDek(kf: KeyFile, cred: Credential): Promise<Buffer> {
  if ('words' in cred) return wordsToDek(cred.words)
  if ('password' in cred) {
    if (kf.mode !== 'password')
      throw new VaultError('BAD_STATE', { message: VAULT_COPY.badState.notPasswordMode })
    return unwrapPassword(kf, cred.password)
  }
  if (kf.mode !== 'keyring')
    throw new VaultError('BAD_STATE', { message: VAULT_COPY.badState.notKeyringMode })
  let dek: Buffer
  try {
    dek = cred.keyring.decrypt(Buffer.from(kf.blob, 'base64'))
  } catch {
    throw new VaultError('KEYRING_UNAVAILABLE')
  }
  if (dek.length !== DEK_BYTES) {
    dek.fill(0)
    throw new VaultError('KEYRING_UNAVAILABLE')
  }
  return dek
}

async function unwrapPassword(
  kf: Extract<KeyFile, { mode: 'password' }>,
  password: string
): Promise<Buffer> {
  const kek = await deriveKek(password, kf.kdf)
  try {
    const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(kf.nonce, 'base64'), {
      authTagLength: TAG_BYTES
    })
    decipher.setAAD(aadOf(kf.kdf))
    decipher.setAuthTag(Buffer.from(kf.tag, 'base64'))
    try {
      return Buffer.concat([decipher.update(Buffer.from(kf.ct, 'base64')), decipher.final()])
    } catch {
      // Tag GCM não confere: senha errada ou arquivo adulterado (inclusive parâmetros do KDF).
      throw new VaultError('WRONG_PASSWORD')
    }
  } finally {
    kek.fill(0)
  }
}
