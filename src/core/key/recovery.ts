import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { VAULT_COPY } from '../../shared/copy/vault'
import { fold } from '../db/fold'
import { DEK_BYTES } from './dek'
import { VaultError } from './errors'

export const WORDS_COUNT = 24

const WORDSET: ReadonlySet<string> = new Set(wordlist)
// Linha do arquivo salvo: "01 palavra" (aceita "1." e "1)" de quem redigitou à mão).
const NUMBERED_LINE = /^\s*\d{1,2}[.)]?\s+(\S+)/

/** DEK (32 bytes) → 24 palavras BIP39 em inglês (256 bits + 8 de checksum). */
export function dekToWords(dek: Buffer): string[] {
  if (dek.length !== DEK_BYTES) throw new Error(`DEK precisa de ${DEK_BYTES} bytes`)
  return entropyToMnemonic(dek, wordlist).split(' ')
}

/**
 * Normaliza o que o usuário colou ou abriu. Se houver linhas numeradas (o arquivo salvo),
 * usa só a palavra dessas linhas e ignora título e aviso; senão divide em espaço/vírgula.
 */
export function parseWords(input: string): string[] {
  const text = fold(input)
  const numbered = text
    .split(/\r?\n/)
    .map((l) => NUMBERED_LINE.exec(l)?.[1])
    .filter((w): w is string => w !== undefined)
  if (numbered.length > 0) return numbered
  return text.split(/[\s,]+/).filter((w) => w.length > 0)
}

/** Palavras → DEK. Lança `WORDS_COUNT`, `WORDS_UNKNOWN` (com `index`) ou `WORDS_CHECKSUM`. */
export function wordsToDek(input: string): Buffer {
  const words = parseWords(input)
  if (words.length !== WORDS_COUNT) throw new VaultError('WORDS_COUNT')
  const unknown = words.findIndex((w) => !WORDSET.has(w))
  if (unknown >= 0) throw new VaultError('WORDS_UNKNOWN', { index: unknown })
  let entropy: Uint8Array
  try {
    entropy = mnemonicToEntropy(words.join(' '), wordlist)
  } catch {
    // Com contagem e palavras válidas, o único erro possível é o checksum. A mensagem da lib
    // não é repassada.
    throw new VaultError('WORDS_CHECKSUM')
  }
  return Buffer.from(entropy)
}

const p2 = (n: number): string => String(n).padStart(2, '0')

/** Texto do arquivo de recuperação (data local, como os nomes de backup). */
export function recoveryFileText(words: string[], now: Date): string {
  const ymd = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
  return [
    VAULT_COPY.recoveryTitle,
    VAULT_COPY.recoveryGenerated(ymd),
    '',
    ...words.map((w, i) => `${p2(i + 1)} ${w}`),
    ''
  ].join('\n')
}
