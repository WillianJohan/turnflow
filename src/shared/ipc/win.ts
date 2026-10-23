import { z } from 'zod'
import { defineChannel } from './define'
import { NoInput } from './common'

export const winFocus = defineChannel('win:focus', NoInput, z.void(), 'send')
