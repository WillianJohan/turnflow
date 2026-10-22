import { z } from 'zod'
import { defineChannel } from './define'
import { NoInput } from './common'
import { VAULT_COPY } from '../copy/vault'

const PASSWORD_MAX = 1024
// code points depois do NFC: é assim que o vault conta o mínimo (Global Constraints)
const codePoints = (s: string): number => [...s.normalize('NFC')].length

// Teto em UTF-16 só barra lixo antes do refine; quem decide é a contagem em code points.
const Password = z
  .string()
  .max(PASSWORD_MAX * 4)
  .refine((s) => codePoints(s) <= PASSWORD_MAX, VAULT_COPY.passwordTooLong(PASSWORD_MAX))

export const BootZ = z.object({
  state: z.enum(['first_run', 'locked', 'ready', 'failed']),
  backend: z.enum(['real', 'basic_text']),
  lock: z.enum(['password', 'keyring_unavailable', 'keyfile_corrupt']).nullable(),
  failure: z
    .object({
      code: z.enum(['MIGRATION_FAILED', 'NEWER_SCHEMA', 'OPEN_FAILED']),
      message: z.string()
    })
    .nullable(),
  version: z.string()
})
export type Boot = z.infer<typeof BootZ>

export const NewPassword = Password.refine(
  (s) => codePoints(s) >= 12,
  VAULT_COPY.errors.PASSWORD_TOO_SHORT
)
export const Words = z.string().min(1).max(4000)

export const bootGet = defineChannel('boot.get', NoInput, BootZ)
export const firstRunBegin = defineChannel(
  'firstRun.begin',
  z.object({ password: NewPassword.optional() }).strict(),
  z.object({ words: z.array(z.string()).length(24) })
)
export const firstRunSaveWords = defineChannel(
  'firstRun.saveWords',
  NoInput,
  z.object({ path: z.string() }).nullable()
)
export const firstRunCommit = defineChannel(
  'firstRun.commit',
  z.object({ saved: z.literal(true) }).strict(),
  BootZ
)
export const vaultUnlock = defineChannel(
  'vault.unlock',
  z.object({ password: Password.refine((s) => s.length > 0, VAULT_COPY.passwordEmpty) }).strict(),
  BootZ
)
export const vaultRecover = defineChannel(
  'vault.recover',
  z.object({ words: Words, newPassword: NewPassword.optional() }).strict(),
  BootZ
)
