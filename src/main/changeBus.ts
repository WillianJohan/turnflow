import type { DomainChanged, Entity } from '../shared/ipc/events'

export type Change = DomainChanged
type Op = Change['op']

type Opts = {
  windowMs?: number
  emit: (e: DomainChanged) => void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

// Junta os domain.changed numa janela (50 ms): uma rajada de commits vira um evento por entity+op.
// Mesmo id na janela: a última op vence (upsert→delete→upsert sai só como upsert).
// afterCommit é o único ponto de entrada; quem chama é o banco, depois do commit (rollback não chama).
export function createChangeBus(opts: Opts): {
  afterCommit(change: Change): void
  dispose(): void
} {
  const {
    windowMs = 50,
    emit,
    setTimer = setTimeout,
    clearTimer = (t) => clearTimeout(t as ReturnType<typeof setTimeout>)
  } = opts
  const pending = new Map<Entity, Map<string, Op>>()
  let timer: unknown = null
  let disposed = false

  const flush = (): void => {
    timer = null
    const batch = [...pending]
    pending.clear()
    for (const [entity, ops] of batch) {
      const byOp = new Map<Op, string[]>()
      for (const [id, op] of ops) {
        const ids = byOp.get(op)
        if (ids) ids.push(id)
        else byOp.set(op, [id])
      }
      for (const [op, ids] of byOp) {
        try {
          emit({ entity, ids, op })
        } catch (e) {
          console.error('[changeBus] emit falhou', e)
        }
      }
    }
  }

  return {
    afterCommit({ entity, ids, op }) {
      if (disposed) return
      const ops = pending.get(entity) ?? new Map<string, Op>()
      ids.forEach((id) => ops.set(id, op))
      pending.set(entity, ops)
      timer ??= setTimer(flush, windowMs)
    },
    dispose() {
      disposed = true
      if (timer !== null) clearTimer(timer)
      timer = null
      pending.clear()
    }
  }
}
