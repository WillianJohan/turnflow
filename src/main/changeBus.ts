import type { DomainChanged } from '../shared/ipc/events'

export type Change = DomainChanged

type Opts = {
  windowMs?: number
  emit: (e: DomainChanged) => void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

// Junta os domain.changed numa janela (50 ms): uma rajada de commits vira um evento por entity+op.
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
  const pending = new Map<
    string,
    { entity: Change['entity']; op: Change['op']; ids: Set<string> }
  >()
  let timer: unknown = null

  const flush = (): void => {
    timer = null
    const batch = [...pending.values()]
    pending.clear()
    for (const { entity, op, ids } of batch) {
      try {
        emit({ entity, ids: [...ids], op })
      } catch (e) {
        console.error('[changeBus] emit falhou', e)
      }
    }
  }

  return {
    afterCommit({ entity, ids, op }) {
      const key = `${entity}:${op}`
      const slot = pending.get(key) ?? { entity, op, ids: new Set<string>() }
      ids.forEach((id) => slot.ids.add(id))
      pending.set(key, slot)
      timer ??= setTimer(flush, windowMs)
    },
    dispose() {
      if (timer !== null) clearTimer(timer)
      timer = null
      pending.clear()
    }
  }
}
