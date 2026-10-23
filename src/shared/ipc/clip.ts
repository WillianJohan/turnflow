import { z } from 'zod'
import { defineChannel } from './define'
import { NoInput } from './common'

export const clipRead = defineChannel(
  'clip:read',
  NoInput,
  z.object({ text: z.string(), image: z.boolean() })
)
export const clipWrite = defineChannel(
  'clip:write',
  z.object({ text: z.string().max(10 * 1024 * 1024) }).strict(),
  z.void(),
  'send'
)
