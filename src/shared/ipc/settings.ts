import { z } from 'zod'
import { defineChannel } from './define'
import { NoInput } from './common'

export const settingsPath = defineChannel('settings:path', NoInput, z.string())
