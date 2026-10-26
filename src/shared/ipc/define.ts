import type { z } from 'zod'

// invoke = pedido/resposta (devolve Result); send = fire-and-forget, sem canal de volta
export type Kind = 'invoke' | 'send'
export type Channel<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
  K extends Kind = Kind
> = { name: string; input: I; output: O; kind: K }

export const defineChannel = <
  I extends z.ZodTypeAny,
  O extends z.ZodTypeAny,
  K extends Kind = 'invoke'
>(
  name: string,
  input: I,
  output: O,
  kind: K = 'invoke' as K
): Channel<I, O, K> => ({ name, input, output, kind })
