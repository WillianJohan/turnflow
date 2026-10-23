import { z } from 'zod'
import { defineChannel } from './define'
import { NoInput } from './common'

export const fontsList = defineChannel(
  'fonts:list',
  NoInput,
  z.object({ all: z.array(z.string()), mono: z.array(z.string()) })
)
