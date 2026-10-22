export const MIN_PANEL = 200

// Divisória entre dois painéis: dx em px vira novos pesos (flex-grow), mantendo a soma dos dois.
export function dragSizes(
  a: number,
  b: number,
  wa: number,
  wb: number,
  dx: number
): [number, number] {
  const total = wa + wb
  const na = Math.min(total - MIN_PANEL, Math.max(MIN_PANEL, wa + dx))
  const sum = a + b
  return [(sum * na) / total, sum - (sum * na) / total]
}
