const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

// Subsequência: cada letra da query em ordem. Contíguo e início de palavra pontuam mais.
export function fuzzyScore(query: string, text: string): number | null {
  const q = norm(query.trim())
  const t = norm(text)
  let score = 0
  let ti = 0
  let prev = -2
  for (const ch of q) {
    if (ch === ' ') continue
    const i = t.indexOf(ch, ti)
    if (i < 0) return null
    score += 1 + (i === prev + 1 ? 3 : 0) + (i === 0 || /[\s\-_]/.test(t[i - 1]) ? 2 : 0)
    prev = i
    ti = i + 1
  }
  return score
}
