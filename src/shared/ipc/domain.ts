import { z } from 'zod'
import {
  ActivityRow,
  CreateTaskInput,
  Flow,
  Limits,
  MoveInput,
  ProjectDetail,
  ProjectInput,
  ProjectRow,
  SaveStageInput,
  StageMapping,
  TaskDetail,
  TaskPatch,
  TaskRow,
  TaskType,
  Workdir
} from '../contracts'
import { Id, NoInput } from './common'
import { defineChannel } from './define'

// Canais do domínio (E3). Output = schemas do contracts.ts; toda escrita passa por `runCommand`.

const ById = z.object({ id: Id }).strict()

/** Resultado de comando sobre uma task: `row` é `null` quando ela termina apagada (Decisão 28). */
export const TaskCommandOut = z.object({
  row: TaskRow.nullable(),
  activity_id: z.string().nullable()
})
export type TaskCommandOut = z.infer<typeof TaskCommandOut>
const WithOutbox = TaskCommandOut.extend({ outbox: z.enum(['queued', 'none']) })

/** Apagar pela UI: a tela confirmou antes (Decisão 9); sem `confirmed: true` é VALIDATION. */
const Confirmed = z.object({ id: Id, confirmed: z.literal(true) }).strict()

export const TaskScopeZ = z.union([
  z.literal('attention'),
  z.object({ project_id: Id }).strict(),
  z.object({ done_since: z.string().datetime().optional() }).strict(),
  z.object({ ids: z.array(Id).max(500) }).strict()
])

export const AttentionCounts = z.object({
  sua_vez: z.number().int(),
  pendente: z.number().int(),
  encaminhado: z.number().int(),
  fila_projeto: z.number().int()
})

// leituras
export const taskList = defineChannel(
  'task.list',
  z.object({ scope: TaskScopeZ }).strict(),
  z.array(TaskRow)
)
/** `id` = ULID ou key (`T-n`). */
export const taskGet = defineChannel('task.get', ById, TaskDetail)
export const attentionCounts = defineChannel('attention.counts', NoInput, AttentionCounts)
export const flowList = defineChannel('flow.list', NoInput, z.array(Flow))
export const taskTypeList = defineChannel('taskType.list', NoInput, z.array(TaskType))
export const projectList = defineChannel('project.list', NoInput, z.array(ProjectRow))
export const projectGet = defineChannel('project.get', ById, ProjectDetail)
export const activityList = defineChannel(
  'activity.list',
  z
    .object({
      task_id: Id.optional(),
      before: Id.optional(),
      limit: z.number().int().min(1).max(200).optional()
    })
    .strict(),
  z.array(ActivityRow)
)

// escritas de task
export const taskCreate = defineChannel('task.create', CreateTaskInput, TaskCommandOut)
export const taskUpdate = defineChannel(
  'task.update',
  z.object({ id: Id, patch: TaskPatch }).strict(),
  TaskCommandOut
)
export const taskSetWorkdir = defineChannel(
  'task.setWorkdir',
  z.object({ id: Id, workdir: Workdir.nullable() }).strict(),
  TaskCommandOut
)
export const taskSetStage = defineChannel(
  'task.setStage',
  z.object({ id: Id, stage_id: Id }).strict(),
  WithOutbox
)
export const taskClose = defineChannel('task.close', ById, WithOutbox)
export const taskBlock = defineChannel(
  'task.block',
  z.object({ id: Id, reason: z.string().max(Limits.reason) }).strict(),
  TaskCommandOut
)
export const taskUnblock = defineChannel('task.unblock', ById, TaskCommandOut)
export const taskDismiss = defineChannel('task.dismiss', ById, TaskCommandOut)
export const taskDelete = defineChannel('task.delete', Confirmed, TaskCommandOut)
export const taskMove = defineChannel('task.move', MoveInput, TaskCommandOut)
export const taskSetFlow = defineChannel(
  'task.setFlow',
  z.object({ id: Id, flow_id: Id, mapping: StageMapping.optional() }).strict(),
  TaskCommandOut
)
export const checkpointAdd = defineChannel(
  'checkpoint.add',
  z.object({ task_id: Id, text: z.string().max(Limits.checkpoint) }).strict(),
  TaskCommandOut.extend({ checkpoint_id: z.string() })
)

// projetos e fluxos
export const projectCreate = defineChannel('project.create', ProjectInput, ProjectRow)
export const projectUpdate = defineChannel(
  'project.update',
  z.object({ id: Id, patch: ProjectInput.partial() }).strict(),
  ProjectRow
)
export const projectDelete = defineChannel(
  'project.delete',
  Confirmed,
  z.object({ deleted: z.literal(true), task_ids: z.array(z.string()) })
)
export const flowSaveStage = defineChannel('flow.saveStage', SaveStageInput, Flow)
export const flowDeleteStage = defineChannel(
  'flow.deleteStage',
  z.object({ id: Id, to_stage_id: Id.optional() }).strict(),
  Flow
)

export const activityUndo = defineChannel(
  'activity.undo',
  z.object({ activity_id: Id }).strict(),
  TaskCommandOut
)
