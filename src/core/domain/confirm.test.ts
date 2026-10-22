import { describe, expect, it } from 'vitest'
import { COMMAND_OPS } from './commands'
import { needsConfirm, type CommandOp } from './confirm'

const EXPECTED: Record<CommandOp, boolean> = {
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

describe('needsConfirm', () => {
  const all: CommandOp[] = [...COMMAND_OPS, 'comment_remote']

  it('tem uma linha esperada para cada op, e só ela', () => {
    expect([...all].sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it.each(all)('%s', (op) => {
    expect(needsConfirm(op)).toBe(EXPECTED[op])
  })

  it('pede confirmação exatamente para apagar task, comentar no remoto e apagar projeto', () => {
    expect(all.filter(needsConfirm).sort()).toEqual(
      ['comment_remote', 'project_delete', 'task_delete'].sort()
    )
  })

  it('op desconhecida em runtime pede confirmação (fail-closed)', () => {
    expect(needsConfirm('op_que_nao_existe' as CommandOp)).toBe(true)
  })
})
