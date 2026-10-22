// Textos que o core e o main produzem sobre o domínio (erros, resumo da Atividade, "mudou depois").
// pt-BR; o E6.9 troca por i18n. Nunca interpolar título, descrição ou checkpoint de task aqui.

export type NotFoundEntity = 'task' | 'project' | 'activity' | 'flow' | 'stage' | 'type'

const ERRORS = {
  title_required: 'Dê um título para a task',
  reason_required: 'Diga o motivo do bloqueio',
  workdir_relative: 'A pasta de trabalho precisa ser um caminho absoluto',
  stage_not_in_flow: 'Essa etapa não é do fluxo da task',
  no_final_stage: 'O fluxo da task não tem etapa final',
  final_change_with_tasks: 'Não dá para mudar se a etapa é final enquanto houver task nela',
  last_final: 'O fluxo precisa de pelo menos uma etapa final',
  last_stage: 'O fluxo precisa de pelo menos uma etapa',
  stage_has_tasks: 'A etapa tem tasks: escolha para onde elas vão antes de apagar',
  choose_keep_adopt: 'O projeto usa outro fluxo: mantenha o da task ou adote o do projeto',
  remap_required: 'Escolha a etapa equivalente no fluxo novo',
  not_undoable: 'Essa ação não pode ser desfeita',
  already_undone: 'Já foi desfeito',
  expired: 'Passou o prazo de 7 dias para desfazer',
  task_deleted: 'A task foi apagada',
  changed_after: 'Mudou depois',
  needs_confirmation: 'Essa ação precisa de confirmação',
  text_required: 'Escreva o texto',
  not_found: 'Não encontrado',
  too_long: 'Texto longo demais'
} as const

export type DomainErrorReason = keyof typeof ERRORS

const NOT_FOUND: Record<NotFoundEntity, string> = {
  task: 'Task não encontrada',
  project: 'Projeto não encontrado',
  activity: 'Atividade não encontrada',
  flow: 'Fluxo não encontrado',
  stage: 'Etapa não encontrada',
  type: 'Tipo não encontrado'
}

const ACTOR = {
  user: 'você',
  mcp: 'IA',
  sync: 'sincronização',
  assistant: 'assistente',
  import: 'importação'
} as const

const FIELD: Record<string, string> = {
  title: 'título',
  description: 'descrição',
  sum_what: 'o quê',
  sum_where: 'parei em',
  sum_next: 'próximo',
  workdir: 'pasta de trabalho'
}

type Data = Record<string, unknown> & { fields?: string[] }

const str = (v: unknown): string => (typeof v === 'string' ? v : '?')
const arrow = (d: Data): string => `${str(d.from)} → ${str(d.to)}`

const SUMMARY: Record<string, (d: Data) => string> = {
  task_create: () => 'criou a task',
  task_update: (d) => `editou ${(d.fields ?? []).map((f) => FIELD[f] ?? f).join(', ') || 'a task'}`,
  task_set_stage: (d) => `mudou de etapa: ${arrow(d)}`,
  task_delete: () => 'apagou a task',
  task_block: () => 'bloqueou',
  task_unblock: () => 'desbloqueou',
  task_dismiss: () => 'dispensou a vez',
  task_move: () => 'moveu de projeto',
  task_set_flow: () => 'trocou o fluxo',
  checkpoint_add: () => 'registrou um checkpoint',
  stage_remap: (d) => `remapeou a etapa: ${arrow(d)}`,
  project_delete: (d) => `apagou o projeto ${str(d.name)}`,
  undo: () => 'desfez uma ação'
}

export const DOMAIN_COPY = {
  /** Um texto por `details.reason` do `DomainError`. */
  errors: ERRORS,
  /** Texto do `NOT_FOUND` por `details.entity`. */
  notFound: (entity: NotFoundEntity): string => NOT_FOUND[entity],
  /** Rótulo de quem fez a ação, para a Atividade e o "mudou depois". */
  actor: ACTOR,
  changedAfter: (label?: string): string =>
    label ? `mudou depois (por ${label})` : 'mudou depois',
  /** Resumo de uma linha da Atividade, a partir de `activity.op` e `activity.data`. */
  summary: (op: string, data: Data): string => (SUMMARY[op] ?? (() => op))(data)
}
