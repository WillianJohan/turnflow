import { z } from 'zod'
import { UiFileZ } from '../uiFile'
import { NoInput } from './common'
import { defineChannel } from './define'

export const uiGet = defineChannel('ui.get', NoInput, z.union([UiFileZ, z.null()]))
export const uiSet = defineChannel('ui.set', UiFileZ, UiFileZ)
