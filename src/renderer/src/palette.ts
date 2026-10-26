import type { SearchHit } from '../../shared/ipc/search'
import { SHELL_COPY } from '../../shared/copy/shell'
import type { CommandDef } from './commands'
import { fuzzyScore } from './fuzzy'

const BUG = /\b(fix|bug|corrigir|corrige|consertar|erro|broken)\b/i
const PERSONAL = /\b(pessoal|personal|privado|private)\b/i

export type PaletteItem =
  | { kind: 'command'; id: string; label: string }
  | { kind: 'task'; id: string; key: string; title: string; done: boolean }
  | {
      kind: 'create'
      title: string
      typeId: string
      typeName: string
      projectId: string | null
      projectName: string | null
    }

export const NEW_ACTIONS = [
  { id: 'task', label: SHELL_COPY.newMenu.task },
  { id: 'project', label: SHELL_COPY.newMenu.project },
  { id: 'claude', label: SHELL_COPY.newMenu.claude },
  { id: 'terminal', label: SHELL_COPY.newMenu.terminal }
] as const

/** Task achada pela paleta: do domínio (id = ULID) ou do brain legado (id = key). */
export type Found = { id: string; key: string; title: string; done: boolean }

/**
 * Uma linha por task, na ordem do FTS. Vários hits da mesma task (título e checkpoints) viram um;
 * a task do brain com a mesma key de um hit do domínio some (o domínio vence).
 */
export function mergeFound(
  hits: SearchHit[],
  brain: { id: string; title: string }[],
  query: string,
  doneIds: ReadonlySet<string> = new Set()
): Found[] {
  const out: Found[] = []
  const seen = new Set<string>()
  const keys = new Set<string>()
  for (const hit of hits) {
    if (seen.has(hit.task_id)) continue
    seen.add(hit.task_id)
    keys.add(hit.key)
    out.push({ id: hit.task_id, key: hit.key, title: hit.title, done: doneIds.has(hit.task_id) })
  }
  const q = query.trim()
  if (!q) return out
  const legacy = brain
    .filter((task) => !keys.has(task.id))
    .map((task) => ({ task, score: fuzzyScore(q, `${task.id} ${task.title}`) }))
    .filter((x) => x.score !== null)
    .sort((a, b) => b.score! - a.score!)
  for (const { task } of legacy)
    out.push({ id: task.id, key: task.id, title: task.title, done: false })
  return out
}

export type NewAction = (typeof NEW_ACTIONS)[number]['id']

export function guessType(query: string, types: { id: string; name: string }[]): string | null {
  if (!types.length) return null
  const want = BUG.test(query) ? /bug/i : PERSONAL.test(query) ? /personal|pessoal/i : null
  if (want) {
    const hit = types.find((type) => want.test(type.name))
    if (hit) return hit.id
  }
  return types[0].id
}

export function cycleType(types: { id: string }[], currentId: string): string | null {
  if (!types.length) return null
  const index = types.findIndex((type) => type.id === currentId)
  return types[(index + 1) % types.length].id
}

export function projectChip(
  query: string,
  projects: { id: string; name: string }[]
): { id: string; name: string } | null {
  const q = query.toLocaleLowerCase()
  const hits = projects.filter((project) => {
    const name = project.name.trim().toLocaleLowerCase()
    return name.length >= 2 && q.includes(name)
  })
  hits.sort((a, b) => b.name.length - a.name.length)
  return hits[0] ?? null
}

const MAX_TASKS = 20

/**
 * `search` (Ctrl+Shift+K): achar vem antes de criar, então as tasks encontradas ficam em cima e o
 * "Create" por último. `new` (+ Novo > Task): o usuário veio criar, então o "Create" vem primeiro.
 */
export function paletteItems(input: {
  query: string
  found: Found[]
  types: { id: string; name: string }[]
  projects: { id: string; name: string }[]
  commands: CommandDef[]
  mode: 'search' | 'new'
  typeId?: string
}): PaletteItem[] {
  const query = input.query.trim()
  if (query.startsWith('>')) {
    const q = query.slice(1).trim().toLocaleLowerCase()
    return input.commands
      .filter((command) => command.enabled)
      .filter(
        (command) => !q || command.label.toLocaleLowerCase().includes(q) || command.id.includes(q)
      )
      .map((command) => ({ kind: 'command' as const, id: command.id, label: command.label }))
  }
  const tasks: PaletteItem[] = input.found
    .slice(0, MAX_TASKS)
    .map((task) => ({ kind: 'task' as const, ...task }))
  if (!query) return tasks
  const typeId = input.typeId ?? guessType(query, input.types)
  const type = input.types.find((item) => item.id === typeId) ?? input.types[0]
  if (!type) return tasks
  const project = projectChip(query, input.projects)
  const create: PaletteItem = {
    kind: 'create',
    title: query,
    typeId: type.id,
    typeName: type.name,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null
  }
  return input.mode === 'new' ? [create, ...tasks] : [...tasks, create]
}
