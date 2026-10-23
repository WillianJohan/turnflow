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
export const sessionPickWorkdir = defineChannel(
  'session.pickWorkdir',
  NoInput,
  z.string().nullable()
)
