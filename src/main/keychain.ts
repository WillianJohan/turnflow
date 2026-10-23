import { safeStorage, type SafeStorage } from 'electron'
import type { KeyBackend } from '../core/key/backend'

type SafeStorageLike = Pick<
  SafeStorage,
  'isEncryptionAvailable' | 'encryptString' | 'decryptString'
> & {
  getSelectedStorageBackend?: () => string
}

const HEX = /^(?:[0-9a-f]{2})*$/

/**
 * Chaveiro do SO via `safeStorage`. A interface recebe a DEK crua; o `safeStorage` cifra string,
 * então a DEK passa em hex. Chamar só depois do `app.whenReady()`.
 */
export function safeStorageBackend(
  ss: SafeStorageLike = safeStorage,
  platform: NodeJS.Platform = process.platform
): KeyBackend {
  return {
    kind: () => {
      if (!ss.isEncryptionAvailable()) return 'basic_text'
      // No Linux sem keyring o Chromium cai num "basic_text" que não protege nada.
      if (platform === 'linux' && ss.getSelectedStorageBackend?.() === 'basic_text')
        return 'basic_text'
      return 'real'
    },
    encrypt: (plain) => ss.encryptString(plain.toString('hex')),
    decrypt: (blob) => {
      const hex = ss.decryptString(blob)
      if (!HEX.test(hex)) throw new Error('safeStorage devolveu um valor inválido')
      return Buffer.from(hex, 'hex')
    }
  }
}

/** Backend de chave do app. O override por env só existe no build de teste. */
export async function selectKeyBackend(env: NodeJS.ProcessEnv = process.env): Promise<KeyBackend> {
  if (__TURNFLOW_TEST__ && env.TURNFLOW_TEST_KEYRING) {
    const kind = env.TURNFLOW_TEST_KEYRING
    if (kind !== 'real' && kind !== 'basic_text')
      throw new Error(`TURNFLOW_TEST_KEYRING inválido: ${kind}`)
    return (await import('./testing/keyring')).testKeyBackend(kind)
  }
  return safeStorageBackend()
}
