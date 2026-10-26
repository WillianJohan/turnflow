export const MIN_PANEL = 300

// Divisória entre dois painéis: dx em px vira novos pesos (flex-grow), mantendo a soma dos dois.
export function dragSizes(
  a: number,
  b: number,
  wa: number,
  wb: number,
  dx: number
): [number, number] {
  const total = wa + wb
  const sum = a + b
  // dois painéis que já não cabem os dois mínimos (janela estreita): não há o que arrastar
  if (!(total > 2 * MIN_PANEL)) return [a, b]
  const na = Math.min(total - MIN_PANEL, Math.max(MIN_PANEL, wa + dx))
  return [(sum * na) / total, sum - (sum * na) / total]
}
