// Índice fracionário no formato do `fractional-indexing` (a0, a1, …, az, b00): a lib é ESM-only
// e o main é CJS (Decisão 16). O E3 só acrescenta no fim; o "entre dois" vem no E12.2.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** Tamanho da parte inteira (cabeça + dígitos): `a` = 2, `b` = 3 …; `Z` = 2, `Y` = 3 … */
function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2
  throw new Error(`rank inválido: cabeça ${JSON.stringify(head)}`)
}

function integerPart(key: string): string {
  const n = integerLength(key.charAt(0))
  const int = key.slice(0, n)
  if (int.length !== n || [...key].some((c, i) => i > 0 && !DIGITS.includes(c)))
    throw new Error(`rank inválido: ${JSON.stringify(key)}`)
  return int
}

function incrementInteger(int: string): string {
  const head = int.charAt(0)
  const digits = [...int.slice(1)]
  for (let i = digits.length - 1; i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i]) + 1
    if (next < DIGITS.length) {
      digits[i] = DIGITS[next]
      return head + digits.join('')
    }
    digits[i] = DIGITS[0]
  }
  // estourou os dígitos: troca de cabeça (mais um dígito nos positivos, menos um nos negativos)
  if (head === 'Z') return 'a' + DIGITS[0]
  if (head === 'z') throw new Error('rank esgotado')
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1)
  if (nextHead > 'a') digits.push(DIGITS[0])
  else digits.pop()
  return nextHead + digits.join('')
}

/** Primeira chave depois de `prev` (ou `a0` sem anterior). A parte fracionária de `prev` é ignorada. */
export function rankAfter(prev: string | null): string {
  if (prev === null) return 'a' + DIGITS[0]
  return incrementInteger(integerPart(prev))
}
