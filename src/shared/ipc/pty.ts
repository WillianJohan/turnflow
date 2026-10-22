import { z } from 'zod'
import type { How } from '../types'
import { defineChannel } from './define'
import { Cells, Id, MAX_PTY_DATA } from './common'

export const HowZ = z.union([
  z.object({ resume: Id }).strict(),
  z.object({ newPrompt: z.literal(true) }).strict()
]) satisfies z.ZodType<How>

const Size = { cols: Cells, rows: Cells }
const Data = z.string().max(MAX_PTY_DATA)

export const ptyStart = defineChannel(
  'pty:start',
  z.object({ id: Id, how: HowZ, ...Size }).strict(),
  z.void()
)
export const ptyStartUpdate = defineChannel('pty:startUpdate', z.object(Size).strict(), z.void())
export const ptyStartScratch = defineChannel(
  'pty:startScratch',
  z.object({ id: Id, ...Size }).strict(),
  z.void()
)
export const ptyWrite = defineChannel(
  'pty:write',
  z.object({ id: Id, data: Data }).strict(),
  z.void(),
  'send'
)
// devolve false se a sessão já tinha morrido: o renderer só limpa o rascunho com true
export const ptySend = defineChannel(
  'pty:send',
  z.object({ id: Id, data: Data }).strict(),
  z.boolean()
)
export const ptyResize = defineChannel(
  'pty:resize',
  z.object({ id: Id, ...Size }).strict(),
  z.void(),
  'send'
)
export const ptyKill = defineChannel('pty:kill', z.object({ id: Id }).strict(), z.void(), 'send')
