import type { CommandDef } from './commands'

const BUG = /\b(fix|bug|corrigir|corrige|consertar|erro|broken)\b/i
const PERSONAL = /\b(pessoal|personal|privado|private)\b/i

export type PaletteItem =
  | { kind: 'command'; id: string; label: string }
  | { kind: 'task'; id: string; title: string }
  | {
      kind: 'create'
      title: string
      typeId: string
      typeName: string
      projectId: string | null
      projectName: string | null
    }

export const NEW_ACTIONS = [
  { id: 'task', label: 'Task' },
  { id: 'project', label: 'Project' },
  { id: 'claude', label: 'Claude without a task' },
  { id: 'terminal', label: 'Terminal' }
] as const

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

export function paletteItems(input: {
  query: string
  tasks: { id: string; title: string }[]
  types: { id: string; name: string }[]
  projects: { id: string; name: string }[]
  commands: CommandDef[]
  typeId?: string
}): PaletteItem[] {
  const query = input.query.trim()
  if (query.startsWith('>')) {
    const q = query.slice(1).trim().toLocaleLowerCase()
    return input.commands
      .filter(
        (command) => !q || command.label.toLocaleLowerCase().includes(q) || command.id.includes(q)
      )
      .map((command) => ({ kind: 'command' as const, id: command.id, label: command.label }))
  }
  const items: PaletteItem[] = []
  if (query) {
    const typeId = input.typeId ?? guessType(query, input.types)
    const type = input.types.find((item) => item.id === typeId) ?? input.types[0]
    const project = projectChip(query, input.projects)
    if (type) {
      items.push({
        kind: 'create',
        title: query,
        typeId: type.id,
        typeName: type.name,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null
      })
    }
  }
  const q = query.toLocaleLowerCase()
  for (const task of input.tasks) {
    if (!q || `${task.id} ${task.title}`.toLocaleLowerCase().includes(q)) {
      items.push({ kind: 'task', id: task.id, title: task.title })
    }
  }
  return items.slice(0, 20)
}
