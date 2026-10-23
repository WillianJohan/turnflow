// '#14161a' → 'rgb:1414/1616/1a1a' (formato que o terminal devolve no OSC 10/11)
export function oscRgb(hex: string): string | null {
  let h = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  const p = h.toLowerCase().match(/../g)!
  return `rgb:${p.map((x) => x + x).join('/')}`
}
