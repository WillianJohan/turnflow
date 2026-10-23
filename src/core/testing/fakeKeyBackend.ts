// Só testes importam este arquivo.
import type { KeyBackend } from '../key/backend'

const XOR_KEY = Buffer.from('fake-key-backend-xor-0123456789abcdef', 'utf8')

const xor = (b: Buffer): Buffer => Buffer.from(b.map((x, i) => x ^ XOR_KEY[i % XOR_KEY.length]))

/** Chaveiro falso: XOR com chave fixa. `broken` faz `decrypt` lançar (chaveiro sumiu). */
export function fakeKeyBackend(
  kind: 'real' | 'basic_text',
  o: { broken?: boolean } = {}
): KeyBackend {
  return {
    kind: () => kind,
    encrypt: (plain) => xor(plain),
    decrypt: (blob) => {
      if (o.broken) throw new Error('fake keyring indisponível')
      return xor(blob)
    }
  }
}
