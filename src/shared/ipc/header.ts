import { z } from 'zod'
import type { HeaderCache } from '../types'
import { defineChannel } from './define'
import { Id } from './common'

export const HeaderCacheZ = z.object({
  readmeMtime: z.number(),
  jsonlMtime: z.number(),
  generatedAt: z.number().optional(),
  header: z.object({ what: z.string(), where: z.string(), next: z.string() }),
  error: z.string().optional()
}) satisfies z.ZodType<HeaderCache>

export const headerCached = defineChannel(
  'header:cached',
  z.object({ id: Id }).strict(),
  HeaderCacheZ.nullable()
)
export const headerGet = defineChannel(
  'header:get',
  z.object({ id: Id, force: z.boolean() }).strict(),
  HeaderCacheZ.nullable()
)
