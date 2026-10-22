import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { VaultError } from './errors'
import { dekToWords, parseWords, recoveryFileText, wordsToDek } from './recovery'

const now = new Date(2026, 9, 21, 15, 4, 5)

function vaultError(fn: () => unknown): VaultError {
  try {
    fn()
  } catch (e) {
    if (e instanceof VaultError) return e
    throw e
  }
  throw new Error('não lançou')
}

describe('recovery', () => {
  it('ida e volta com 24 palavras', () => {
    for (let i = 0; i < 20; i++) {
      const d = randomBytes(32)
      const words = dekToWords(d)
      expect(words).toHaveLength(24)
      expect(wordsToDek(words.join(' ')).equals(d)).toBe(true)
    }
  })

  it('vetor conhecido: DEK zerada = 23x abandon + art', () => {
    expect(dekToWords(Buffer.alloc(32))).toEqual([...Array(23).fill('abandon'), 'art'])
  })

  it('aceita o arquivo salvo inteiro (título e aviso ignorados)', () => {
    const d = randomBytes(32)
    const text = recoveryFileText(dekToWords(d), now)
    expect(wordsToDek(text).equals(d)).toBe(true)
  })

  it('arquivo de recuperação: título, data, linha em branco e 24 linhas numeradas', () => {
    const words = dekToWords(Buffer.alloc(32))
    const lines = recoveryFileText(words, now).trimEnd().split('\n')
    expect(lines[0]).toMatch(/ — chave de recuperação$/)
    expect(lines[1]).toBe(
      'Gerada em 2026-10-21. Guarde fora deste computador. Quem tiver estas palavras e um backup consegue ler seus dados.'
    )
    expect(lines[2]).toBe('')
    expect(lines.slice(3)).toHaveLength(24)
    expect(lines[3]).toBe('01 abandon')
    expect(lines[26]).toBe('24 art')
  })

  it('caixa, acento, vírgula e quebra de linha', () => {
    const input = `  ABANDON,abandon\nÁbandon ${Array(20).fill('abandon').join(', ')}\n\tARt  `
    expect(parseWords(input)).toHaveLength(24)
    expect(wordsToDek(input).equals(Buffer.alloc(32))).toBe(true)
  })

  it('WORDS_COUNT com 23 palavras', () => {
    const words = dekToWords(randomBytes(32)).slice(0, 23)
    expect(vaultError(() => wordsToDek(words.join(' '))).code).toBe('WORDS_COUNT')
  })

  it('WORDS_UNKNOWN aponta a primeira desconhecida (0-based)', () => {
    const words = dekToWords(randomBytes(32))
    words[4] = 'xyzzy'
    words[9] = 'plugh'
    const e = vaultError(() => wordsToDek(words.join(' ')))
    expect(e.code).toBe('WORDS_UNKNOWN')
    expect(e.details?.index).toBe(4)
    expect(e.message).toBe('A palavra 5 não existe na lista')
  })

  it('WORDS_CHECKSUM com a última trocada por outra palavra válida', () => {
    const words = withWrongChecksum(dekToWords(randomBytes(32)))
    expect(vaultError(() => wordsToDek(words.join(' '))).code).toBe('WORDS_CHECKSUM')
  })

  it('erro não ecoa as palavras digitadas', () => {
    const base = dekToWords(randomBytes(32))
    const unknown = [...base]
    unknown[4] = 'xyzzy'
    for (const words of [base.slice(0, 23), unknown, withWrongChecksum(base)]) {
      const e = vaultError(() => wordsToDek(words.join(' ')))
      // Compara por palavra inteira: "lista" na mensagem não é a palavra "list".
      const tokens = new Set(
        JSON.stringify({ message: e.message, details: e.details }).match(/\p{L}+/gu)
      )
      for (const w of words) expect(tokens.has(w)).toBe(false)
    }
  })
})

/** Troca a última palavra por outra válida que reprova no checksum (só ~1/256 passa). */
function withWrongChecksum(words: string[]): string[] {
  for (const w of ['zoo', 'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb']) {
    if (w === words[23]) continue
    const out = [...words.slice(0, 23), w]
    try {
      wordsToDek(out.join(' '))
    } catch {
      return out
    }
  }
  throw new Error('nenhuma candidata reprovou no checksum')
}
