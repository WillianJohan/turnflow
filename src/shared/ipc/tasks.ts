import { z } from 'zod'
import type { Task } from '../types'
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

export const tasksList = defineChannel('tasks:list', NoInput, z.array(TaskZ))
export const tasksRoot = defineChannel('tasks:root', NoInput, z.string())
export const taskReadme = defineChannel('task:readme', z.object({ id: Id }).strict(), z.string())
