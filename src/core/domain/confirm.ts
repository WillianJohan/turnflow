import type { Command } from './commands'

/** Toda escrita do domínio, mais o comentário no remoto (que só existe a partir do E9). */
export type CommandOp = Command['op'] | 'comment_remote'

/**
 * A tabela é `Record<CommandOp, boolean>`: op novo sem linha aqui não compila. Pede confirmação o
 * que apaga ou fala com o mundo de fora (Decisão 9); mudar de etapa, encerrar e bloquear não, porque
 * têm Desfazer.
 */
const CONFIRM: Record<CommandOp, boolean> = {
  task_create: false,
  task_update: false,
  task_set_stage: false,
  task_close: false,
  task_block: false,
  task_unblock: false,
  task_dismiss: false,
  task_delete: true,
  task_move: false,
  task_set_flow: false,
  checkpoint_add: false,
  activity_undo: false,
  project_create: false,
  project_update: false,
  project_delete: true,
  flow_save_stage: false,
  flow_delete_stage: false,
  comment_remote: true
}

/** A única regra de confirmação: UI, MCP e assistente passam por `runCommand`, que pergunta aqui. */
export function needsConfirm(op: CommandOp): boolean {
  return CONFIRM[op]
}
