import { z } from 'zod'
import type { Plan, Task } from '../types'
import { defineChannel } from './define'
import { Id, NoInput } from './common'

export const TaskZ = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  bucket: z.object({ idx: z.number(), name: z.string() }),
  parent: z.string().nullable(),
  dir: z.enum(['current', 'done']),
  readmePath: z.string(),
  sessions: z.array(z.object({ date: z.string(), uuid: z.string(), desc: z.string() }))
}) satisfies z.ZodType<Task>

export const PlanZ = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('resume'), uuid: z.string(), cwd: z.string() }),
  z.object({
    kind: z.literal('elsewhere'),
    uuid: z.string(),
    pid: z.number(),
    by: z.string().optional()
  }),
  z.object({ kind: z.literal('gone'), uuid: z.string(), cwd: z.string() }),
  z.object({ kind: z.literal('missing'), uuids: z.array(z.string()) }),
  z.object({ kind: z.literal('none') })
]) satisfies z.ZodType<Plan>

export const tasksList = defineChannel('tasks:list', NoInput, z.array(TaskZ))
export const tasksRoot = defineChannel('tasks:root', NoInput, z.string())
export const taskPlan = defineChannel(
  'task:plan',
  z.object({ id: Id, uuid: Id.optional() }).strict(),
  PlanZ
)
export const taskReadme = defineChannel('task:readme', z.object({ id: Id }).strict(), z.string())
