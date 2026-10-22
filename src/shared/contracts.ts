import { z } from 'zod'
import { DOMAIN_COPY } from './copy/domain'
import { Id } from './ipc/common'
import { isAbsolutePath } from './pathSyntax'

export const Group = z.enum(['sua_vez', 'pendente', 'encaminhado', 'fila_projeto', 'concluida'])
export type Group = z.infer<typeof Group>

export const Reason = z.enum([
  'sessao_aguardando',
  'voltou',
  'desbloqueada',
  'atribuida',
  'bloqueada',
  'aguardando_outro',
  'parada_no_projeto'
])
export type Reason = z.infer<typeof Reason>

export const SessionState = z.enum(['working', 'waiting', 'idle', 'unknown'])
export type SessionState = z.infer<typeof SessionState>

export const TurnReason = z.enum(['voltou', 'desbloqueada', 'atribuida'])
export type TurnReason = z.infer<typeof TurnReason>

/** Tetos de tamanho dos textos do domínio (zod no IPC e conferência no core). */
export const Limits = {
  title: 300,
  description: 100_000,
  sum: 2_000,
  reason: 500,
  checkpoint: 20_000,
  workdir: 4_096,
  name: 100,
  goal: 2_000,
  color: 32
} as const

/** Pasta de trabalho: vazia (= limpar) ou absoluta em qualquer SO (Decisão 20). */
export const Workdir = z
  .string()
  .max(Limits.workdir)
  .refine((s) => s === '' || isAbsolutePath(s), DOMAIN_COPY.errors.workdir_relative)

const Title = z.string().trim().min(1, DOMAIN_COPY.errors.title_required).max(Limits.title)

/** `position` = ordinal 1-based entre as etapas vivas; `count` = quantas etapas vivas (Decisão 17). */
export const StageRef = z.object({
  id: z.string(),
  name: z.string(),
  short_name: z.string(),
  position: z.number(),
  count: z.number(),
  is_final: z.boolean()
})
export type StageRef = z.infer<typeof StageRef>

export const TaskRow = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  type_id: z.string(),
  project_id: z.string().nullable(),
  stage: StageRef,
  group: Group,
  reason: z.object({ kind: Reason, since: z.string() }).nullable(),
  blocked_reason: z.string().nullable(),
  session: z.object({ id: z.string(), tool: z.string(), state: SessionState }).nullable(),
  sum_where: z.string().nullable(),
  sum_next: z.string().nullable(),
  touched_at: z.string(),
  faded: z.boolean(),
  // ordenação dentro do grupo, calculada no core (§7)
  sort_key: z.string()
})
export type TaskRow = z.infer<typeof TaskRow>

export const CheckpointZ = z.object({
  id: z.string(),
  at: z.string(),
  text: z.string(),
  source: z.enum(['user', 'ai', 'sync', 'import'])
})
export type Checkpoint = z.infer<typeof CheckpointZ>

export const SessionRow = z.object({
  id: z.string(),
  tool: z.string(),
  external_id: z.string().nullable(),
  state: SessionState,
  state_at: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  label: z.string().nullable()
})
export type SessionRow = z.infer<typeof SessionRow>

export const TaskRemote = z.object({
  remote_key: z.string(),
  url: z.string(),
  remote_status: z.string().nullable()
})
export type TaskRemote = z.infer<typeof TaskRemote>

export const TaskDetail = TaskRow.extend({
  description: z.string(),
  sum_what: z.string().nullable(),
  sum_at: z.string().nullable(),
  sum_source: z.enum(['ai', 'user', 'engine']).nullable(),
  workdir: z.string().nullable(),
  workdir_effective: z.string().nullable(),
  checkpoints: z.array(CheckpointZ),
  sessions: z.array(SessionRow),
  remote: TaskRemote.nullable(),
  flow_stages: z.array(StageRef)
})
export type TaskDetail = z.infer<typeof TaskDetail>

export const CreateTaskInput = z
  .object({
    title: Title,
    description: z.string().max(Limits.description).optional(),
    type_id: Id.optional(),
    project_id: Id.nullable().optional(),
    workdir: Workdir.nullable().optional()
  })
  .strict()
export type CreateTaskInput = z.infer<typeof CreateTaskInput>

/** Só o título não aceita `null`; `workdir: ''` limpa a pasta (vale a padrão). */
export const TaskPatch = z
  .object({
    title: Title.optional(),
    description: z.string().max(Limits.description).nullable().optional(),
    sum_what: z.string().max(Limits.sum).nullable().optional(),
    sum_where: z.string().max(Limits.sum).nullable().optional(),
    sum_next: z.string().max(Limits.sum).nullable().optional(),
    workdir: Workdir.nullable().optional()
  })
  .strict()
export type TaskPatch = z.infer<typeof TaskPatch>

const Name = z.string().trim().min(1).max(Limits.name)

/** Etapa no editor de fluxo: `position` = ordinal 1-based entre as vivas; `live_task_count` = tasks vivas nela. */
export const FlowStage = z.object({
  id: z.string(),
  position: z.number().int(),
  name: z.string(),
  short_name: z.string(),
  waits_other: z.boolean(),
  is_final: z.boolean(),
  remote_star_status: z.string().nullable(),
  live_task_count: z.number().int()
})
export type FlowStage = z.infer<typeof FlowStage>

/** Fluxo com as etapas vivas, em ordem. */
export const Flow = z.object({
  id: z.string(),
  name: z.string(),
  is_default: z.boolean(),
  stages: z.array(FlowStage)
})
export type Flow = z.infer<typeof Flow>

export const TaskType = z.object({
  id: z.string(),
  name: z.string(),
  flow_id: z.string(),
  syncs: z.boolean(),
  icon: z.string().nullable(),
  guideline: z.string().nullable()
})
export type TaskType = z.infer<typeof TaskType>

/** Etapa do fluxo de origem → etapa escolhida no fluxo de destino. */
export const StageMapping = z.record(Id, Id)
export type StageMapping = z.infer<typeof StageMapping>

/** Linha da prévia de remapeamento: etapa de origem e o par sugerido (`null` = sem par). */
export const StagePairing = z.object({
  from: z.object({
    id: z.string(),
    name: z.string(),
    short_name: z.string(),
    position: z.number().int()
  }),
  to_stage_id: z.string().nullable()
})
export type StagePairing = z.infer<typeof StagePairing>

/** Cria (sem `id`) ou atualiza uma etapa; `position` = ordinal desejado entre as vivas. */
export const SaveStageInput = z
  .object({
    flow_id: Id,
    id: Id.optional(),
    name: Name,
    short_name: Name,
    waits_other: z.boolean(),
    is_final: z.boolean(),
    remote_star_status: z.string().max(Limits.name).nullable().optional(),
    position: z.number().int().min(1).optional()
  })
  .strict()
export type SaveStageInput = z.infer<typeof SaveStageInput>

export const ProjectRow = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string().nullable(),
  color: z.string().nullable(),
  flow_id: z.string().nullable(),
  done_at: z.string().nullable(),
  task_count: z.number().int(),
  done_count: z.number().int()
})
export type ProjectRow = z.infer<typeof ProjectRow>

export const ProjectItem = z.object({
  id: z.string(),
  kind: z.enum(['task', 'divider']),
  task_id: z.string().nullable(),
  label: z.string().nullable(),
  rank: z.string()
})
export type ProjectItem = z.infer<typeof ProjectItem>

export const ProjectDetail = ProjectRow.extend({ items: z.array(ProjectItem) })
export type ProjectDetail = z.infer<typeof ProjectDetail>

export const ProjectInput = z
  .object({
    name: Name,
    goal: z.string().max(Limits.goal).nullable().optional(),
    color: z.string().max(Limits.color).nullable().optional(),
    flow_id: Id.nullable().optional()
  })
  .strict()
export type ProjectInput = z.infer<typeof ProjectInput>

/** Move a task para o projeto (`null` = tira do projeto). `choice`/`mapping` só valem se o fluxo do projeto difere. */
export const MoveInput = z
  .object({
    id: Id,
    project_id: Id.nullable(),
    choice: z.enum(['keep', 'adopt']).optional(),
    mapping: StageMapping.optional()
  })
  .strict()
export type MoveInput = z.infer<typeof MoveInput>

/** Linha da Atividade (§3). `undo_blocked_reason` só quando o motivo diz algo ao usuário. */
export const ActivityRow = z.object({
  id: z.string(),
  at: z.string(),
  actor: z.enum(['user', 'mcp', 'sync', 'assistant', 'import']),
  op: z.string(),
  task_id: z.string().nullable(),
  summary: z.string(),
  undoable: z.boolean(),
  undo_blocked_reason: z.string().optional()
})
export type ActivityRow = z.infer<typeof ActivityRow>
