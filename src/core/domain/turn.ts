import type { TurnReason } from '../../shared/contracts'

/** Prioridade do motivo da vez (Decisão 12): o maior não é rebaixado pelo menor. */
export const TURN_PRIORITY: Record<TurnReason, number> = {
  voltou: 3,
  desbloqueada: 2,
  atribuida: 1
}

/**
 * Liga ou sobe o motivo da vez. Vence o de maior prioridade e o `turn_at` fica o mais antigo,
 * então `turn_reason` e `turn_at` saem sempre juntos.
 */
export function raiseTurn(
  cur: { turn_reason: TurnReason | null; turn_at: string | null },
  next: TurnReason,
  nowIso: string
): { turn_reason: TurnReason; turn_at: string } {
  if (cur.turn_reason === null) return { turn_reason: next, turn_at: nowIso }
  const turn_at = cur.turn_at ?? nowIso
  const turn_reason = TURN_PRIORITY[next] > TURN_PRIORITY[cur.turn_reason] ? next : cur.turn_reason
  return { turn_reason, turn_at }
}
