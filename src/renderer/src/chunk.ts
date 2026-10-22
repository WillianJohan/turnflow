import { MAX_PTY_DATA } from '../../shared/ipc/limits'

// Fatia em pedaços ≤ max sem partir um par surrogate (o pty receberia um caractere quebrado).
export function chunks(s: string, max = MAX_PTY_DATA): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length;) {
    let end = Math.min(i + max, s.length)
    const last = s.charCodeAt(end - 1)
    if (end < s.length && end - i > 1 && last >= 0xd800 && last <= 0xdbff) end--
    out.push(s.slice(i, end))
    i = end
  }
  return out
}
