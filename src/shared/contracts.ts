import { z } from 'zod'

export const Group = z.enum(['sua_vez', 'pendente', 'encaminhado', 'fila_projeto', 'concluida'])
export type Group = z.infer<typeof Group>

export const Reason = z.enum([
  'sessao_aguardando',
  'voltou',
  'desbloqueada',
  'atribuida',
  'bloqueada',
  'aguardando_outro',
  'parada_no_projeto'
])
export type Reason = z.infer<typeof Reason>

export const SessionState = z.enum(['working', 'waiting', 'idle', 'unknown'])
export type SessionState = z.infer<typeof SessionState>

export const TurnReason = z.enum(['voltou', 'desbloqueada', 'atribuida'])
export type TurnReason = z.infer<typeof TurnReason>
