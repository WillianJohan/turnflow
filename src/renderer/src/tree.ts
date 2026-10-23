import type { Task } from '../../shared/types'

export type Row = { task: Task; depth: number }

// Pai antes dos filhos; filho de pai inexistente fica na raiz.
export function tree(list: Task[]): Row[] {
  const ids = new Set(list.map((t) => t.id))
  const kids = new Map<string, Task[]>()
  const roots: Task[] = []
  for (const t of list) {
    if (t.parent && ids.has(t.parent) && t.parent !== t.id)
      kids.set(t.parent, [...(kids.get(t.parent) ?? []), t])
    else roots.push(t)
  }
  const out: Row[] = []
  const walk = (t: Task, depth: number): void => {
    out.push({ task: t, depth })
    for (const k of kids.get(t.id) ?? []) walk(k, depth + 1)
  }
  roots.forEach((t) => walk(t, 0))
  // ciclo de Pai (A→B→A): ninguém vira raiz; entra no fim, sem aninhar, em vez de sumir
  const seen = new Set(out.map((r) => r.task.id))
  for (const t of list) if (!seen.has(t.id)) out.push({ task: t, depth: 0 })
  return out
}

// Quantos filhos diretos cada linha tem (a lista vem em pré-ordem, como o tree() devolve).
export function kidCount(rows: Row[]): Map<string, number> {
  const n = new Map<string, number>()
  const stack: Row[] = []
  for (const r of rows) {
    while (stack.length && stack[stack.length - 1].depth >= r.depth) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) n.set(parent.task.id, (n.get(parent.task.id) ?? 0) + 1)
    stack.push(r)
  }
  return n
}

// Esconde os descendentes de quem não está em `expanded`.
export function visibleRows(rows: Row[], expanded: Set<string>): Row[] {
  const out: Row[] = []
  let hideBelow = Infinity
  for (const r of rows) {
    if (r.depth > hideBelow) continue
    hideBelow = expanded.has(r.task.id) ? Infinity : r.depth
    out.push(r)
  }
  return out
}
