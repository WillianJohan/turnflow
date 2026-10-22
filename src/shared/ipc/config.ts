import { z } from 'zod'
import type { AppConfig, ConfigState, Theme } from '../types'
import { defineChannel } from './define'
import { Id, NoInput } from './common'

export const ThemeZ = z.object({
  name: z.string().max(200),
  ui: z.record(z.string()),
  terminal: z.record(z.string())
}) satisfies z.ZodType<Theme>

export const AppConfigZ = z.object({
  theme: z.string(),
  draftMode: z.boolean(),
  notifications: z.boolean(),
  fontSize: z.number(),
  termFont: z.string(),
  appFont: z.string(),
  appFontSize: z.number(),
  statusIcons: z.record(z.string())
}) satisfies z.ZodType<AppConfig>

export const ConfigStateZ = z.object({
  dir: z.string(),
  config: AppConfigZ,
  theme: ThemeZ,
  themes: z.array(z.object({ id: z.string(), name: z.string(), builtin: z.boolean().optional() })),
  error: z.string().optional()
}) satisfies z.ZodType<ConfigState>

export const configGet = defineChannel('config:get', NoInput, ConfigStateZ)
export const configSet = defineChannel('config:set', AppConfigZ.partial().strict(), ConfigStateZ)
export const configCloneTheme = defineChannel(
  'config:cloneTheme',
  z.object({ from: Id }).strict(),
  ConfigStateZ
)
export const configOpenDir = defineChannel('config:openDir', NoInput, z.void(), 'send')
