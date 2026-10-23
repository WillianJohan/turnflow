import { z } from 'zod'
import { defineChannel } from './define'
import { Id } from './common'
import { ConfigStateZ, ThemeZ } from './config'

export const themeRead = defineChannel('theme:read', z.object({ id: Id }).strict(), ThemeZ)
export const themeSave = defineChannel(
  'theme:save',
  z.object({ id: Id, theme: ThemeZ.strict() }).strict(),
  ConfigStateZ
)
export const themeDelete = defineChannel(
  'theme:delete',
  z.object({ id: Id }).strict(),
  ConfigStateZ
)
