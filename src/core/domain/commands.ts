import type {
  CreateTaskInput,
  Flow,
  MoveInput,
  ProjectInput,
  ProjectRow,
  SaveStageInput,
  StageMapping,
  TaskPatch
} from '../../shared/contracts'
import { blockTask, unblockTask } from './block'
import { addCheckpoint } from './checkpoint'
import { needsConfirm, type CommandOp } from './confirm'
import type { Actor, DomainDeps } from './context'
import { domainError } from './errors'
import { deleteStage, saveStage, setTaskFlow } from './flow'
import { createProject, deleteProject, moveTask, updateProject } from './project'
import {
  closeTask,
  createTask,
  deleteTask,
  setStage,
  updateTask,
  type TaskCommandResult
} from './task'
import { adoptSession } from './session'
import { dismissTask } from './turn'
import { undoActivity } from './undo'

/** Fonte única das ops: o tipo `Command['op']` tem que casar com esta lista (`satisfies` abaixo). */
export const COMMAND_OPS = [
  'task_create',
  'task_update',
  'task_set_stage',
  'task_close',
  'task_block',
  'task_unblock',
  'task_dismiss',
  'task_delete',
  'task_move',
  'task_set_flow',
  'checkpoint_add',
  'activity_undo',
  'project_create',
  'project_update',
  'project_delete',
  'flow_save_stage',
  'flow_delete_stage',
  'session_adopt'
] as const

type Outbox = 'queued' | 'none'

export type Command =
  | { op: 'task_create'; input: CreateTaskInput }
  | { op: 'task_update'; id: string; patch: TaskPatch }
  | { op: 'task_set_stage'; id: string; stage_id: string }
  | { op: 'task_close'; id: string }
  | { op: 'task_block'; id: string; reason: string }
  | { op: 'task_unblock'; id: string }
  | { op: 'task_dismiss'; id: string }
  | { op: 'task_delete'; id: string }
  | ({ op: 'task_move' } & MoveInput)
  | { op: 'task_set_flow'; id: string; flow_id: string; mapping?: StageMapping }
  | { op: 'checkpoint_add'; task_id: string; text: string }
  | { op: 'activity_undo'; activity_id: string }
  | { op: 'project_create'; input: ProjectInput }
  | { op: 'project_update'; id: string; patch: Partial<ProjectInput> }
  | { op: 'project_delete'; id: string }
  | { op: 'flow_save_stage'; input: SaveStageInput }
  | { op: 'flow_delete_stage'; id: string; to_stage_id?: string }
  | { op: 'session_adopt'; session_id: string; task_id: string }

type Op = (typeof COMMAND_OPS)[number]
type Assert<T extends true> = T
type SameOps = [Op] extends [Command['op']] ? ([Command['op']] extends [Op] ? true : false) : false
/** Falha o typecheck se uma variante de `Command` ficar fora de `COMMAND_OPS` ou o contrário. */
export type CommandOpsMatch = Assert<SameOps>

export type CommandResults = {
  task_create: TaskCommandResult
  task_update: TaskCommandResult
  task_set_stage: TaskCommandResult & { outbox: Outbox }
  task_close: TaskCommandResult & { outbox: Outbox }
  task_block: TaskCommandResult
  task_unblock: TaskCommandResult
  task_dismiss: TaskCommandResult
  task_delete: TaskCommandResult
  task_move: TaskCommandResult
  task_set_flow: TaskCommandResult
  checkpoint_add: TaskCommandResult & { checkpoint_id: string }
  activity_undo: TaskCommandResult
  project_create: ProjectRow
  project_update: ProjectRow
  project_delete: { deleted: true; task_ids: string[] }
  flow_save_stage: Flow
  flow_delete_stage: Flow
  session_adopt: TaskCommandResult
}

export type CommandOutcome<R> =
  { status: 'done'; result: R } | { status: 'needs_confirmation'; op: CommandOp }

function assertNever(cmd: never): never {
  throw domainError('VALIDATION', 'unknown_op', { op: (cmd as { op?: unknown }).op })
}

function dispatch(d: DomainDeps, actor: Actor, cmd: Command): CommandResults[Command['op']] {
  switch (cmd.op) {
    case 'task_create':
      return createTask(d, actor, cmd.input)
    case 'task_update':
      return updateTask(d, actor, cmd.id, cmd.patch)
    case 'task_set_stage':
      return setStage(d, actor, { id: cmd.id, stage_id: cmd.stage_id })
    case 'task_close':
      return closeTask(d, actor, { id: cmd.id })
    case 'task_block':
      return blockTask(d, actor, { id: cmd.id, reason: cmd.reason })
    case 'task_unblock':
      return unblockTask(d, actor, { id: cmd.id })
    case 'task_dismiss':
      return dismissTask(d, actor, { id: cmd.id })
    case 'task_delete':
      return deleteTask(d, actor, { id: cmd.id })
    case 'task_move': {
      const { op: _op, ...input } = cmd
      void _op
      return moveTask(d, actor, input)
    }
    case 'task_set_flow':
      return setTaskFlow(d, actor, { id: cmd.id, flow_id: cmd.flow_id, mapping: cmd.mapping })
    case 'checkpoint_add':
      return addCheckpoint(d, actor, { task_id: cmd.task_id, text: cmd.text })
    case 'activity_undo':
      return undoActivity(d, actor, { activity_id: cmd.activity_id })
    case 'project_create':
      return createProject(d, actor, cmd.input)
    case 'project_update':
      return updateProject(d, actor, { ...cmd.patch, id: cmd.id })
    case 'project_delete':
      return deleteProject(d, actor, { id: cmd.id })
    case 'flow_save_stage':
      return saveStage(d, actor, cmd.input)
    case 'flow_delete_stage':
      return deleteStage(d, actor, { id: cmd.id, to_stage_id: cmd.to_stage_id })
    case 'session_adopt':
      return adoptSession(d, actor, { session_id: cmd.session_id, task_id: cmd.task_id })
    default:
      return assertNever(cmd)
  }
}

/**
 * O portão de toda escrita (Decisão 8): UI, MCP e assistente entram por aqui. Op que pede
 * confirmação (`needsConfirm`) sem `confirmed` devolve `needs_confirmation` sem tocar no banco.
 * Cada função do domínio abre a própria transação; o portão não abre outra.
 */
export function runCommand<C extends Command>(
  d: DomainDeps,
  actor: Actor,
  cmd: C,
  opts?: { confirmed?: boolean }
): CommandOutcome<CommandResults[C['op']]> {
  if (needsConfirm(cmd.op) && !opts?.confirmed) return { status: 'needs_confirmation', op: cmd.op }
  return { status: 'done', result: dispatch(d, actor, cmd) as CommandResults[C['op']] }
}
