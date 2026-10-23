import { randomBytes } from 'node:crypto'

export const DEK_BYTES = 32

/** DEK nova: 32 bytes aleatórios, usada direto como chave do SQLCipher. Nunca é trocada. */
export function generateDek(random: (n: number) => Buffer = randomBytes): Buffer {
  const dek = random(DEK_BYTES)
  if (dek.length !== DEK_BYTES) throw new Error(`DEK precisa de ${DEK_BYTES} bytes`)
  return dek
}
