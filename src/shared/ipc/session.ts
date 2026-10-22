import { z } from 'zod'
import type { SessionInfo } from '../types'
import { defineChannel } from './define'
import { Id } from './common'

export const SessionInfoZ = z.object({
  uuid: z.string(),
  exists: z.boolean(),
  current: z.boolean(),
  date: z.string(),
  desc: z.string()
}) satisfies z.ZodType<SessionInfo>

export const taskSessions = defineChannel(
  'task:sessions',
  z.object({ id: Id }).strict(),
  z.array(SessionInfoZ)
)
