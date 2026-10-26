import { z } from 'zod'
import { SessionRow } from '../contracts'
import { TaskCommandOut } from './domain'
import { defineChannel } from './define'
import { Id, NoInput } from './common'

export const sessionList = defineChannel(
  'session.list',
  z.object({ task_id: z.string().min(1).max(64).optional() }).strict(),
  z.array(SessionRow)
)
export const sessionAdopt = defineChannel(
  'session.adopt',
  z.object({ session_id: Id, task: z.string().min(1).max(64) }).strict(),
  TaskCommandOut
)
// Sessão atual do pty: a do spawn pode sumir numa fusão (SessionStart de conversa já conhecida).
// Só a janela dona do pty recebe o id; as outras, null.
export const sessionOfPty = defineChannel(
  'session.ofPty',
  z.object({ pty_id: Id }).strict(),
  z.object({ session_id: z.string().nullable() }).strict()
)
export const sessionPickWorkdir = defineChannel(
  'session.pickWorkdir',
  NoInput,
  z.string().nullable()
)
