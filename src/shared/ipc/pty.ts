import { z } from 'zod'
import { SESSION_TOOLS } from '../contracts'
import { defineChannel } from './define'
import { Cells, Id, MAX_PTY_DATA } from './common'

const Size = { cols: Cells, rows: Cells }
const Data = z.string().max(MAX_PTY_DATA)

export const ptySpawn = defineChannel(
  'pty.spawn',
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('agent'),
        pty_id: Id,
        tool: z.enum(SESSION_TOOLS),
        task: z.string().min(1).max(64).nullable(),
        resume: Id.optional(),
        ...Size
      })
      .strict(),
    z.object({ kind: z.literal('shell'), pty_id: Id, ...Size }).strict()
  ]),
  z.object({ session_id: z.string().nullable() }).strict()
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
