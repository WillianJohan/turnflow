import { z } from 'zod'
import { defineChannel } from './define'

/** Marcas de destaque no snippet (controles que não aparecem em texto): a UI troca por <mark>. */
export const HL_OPEN = '\u0002'
export const HL_CLOSE = '\u0003'

export const SearchHitZ = z.object({
  kind: z.enum(['task', 'checkpoint']),
  task_id: z.string(),
  key: z.string(),
  title: z.string(),
  // Texto cru do usuário com HL_OPEN/HL_CLOSE ao redor do trecho casado. A UI divide por esses
  // marcadores e renderiza tudo como texto, nunca como HTML.
  snippet: z.string()
})
export type SearchHit = z.infer<typeof SearchHitZ>

export const searchQuery = defineChannel(
  'search.query',
  z
    .object({ q: z.string().max(200), limit: z.number().int().min(1).max(100).default(30) })
    .strict(),
  z.array(SearchHitZ)
)
