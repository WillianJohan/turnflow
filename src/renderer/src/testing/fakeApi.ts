import type { TaskDetail, TaskRow } from '../../../shared/contracts'
import type { RendererApi } from '../../../shared/ipc/api'
import type { UiFile } from '../../../shared/uiFile'
import type { Task } from '../../../shared/types'

// window.turnflow de mentira para montar a tela real (App/Panels/Sidebar/TaskView) no jsdom.
// Canal sem resposta configurada devolve `ok` vazio; `on*` registra o ouvinte para `emit`.

type Fn = (...args: never[]) => unknown
export type Call = { name: string; args: unknown[] }

export function taskRow(id: string, key: string, patch: Partial<TaskRow> = {}): TaskRow {
  return {
    id,
    key,
    title: `title ${key}`,
    type_id: 'feature',
    project_id: null,
    stage: {
      id: 'st1',
      name: 'Doing',
      short_name: 'Doing',
      position: 1,
      count: 3,
      is_final: false
    },
    group: 'sua_vez',
    reason: null,
    blocked_reason: null,
    session: null,
    sum_where: null,
    sum_next: null,
    touched_at: '2026-10-22T11:00:00.000Z',
    faded: false,
    sort_key: key,
    ...patch
  }
}

export function taskDetail(row: TaskRow, patch: Partial<TaskDetail> = {}): TaskDetail {
  return {
    ...row,
    description: '',
    sum_what: null,
    sum_at: null,
    sum_source: null,
    workdir: null,
    workdir_effective: null,
    checkpoints: [],
    sessions: [],
    remote: null,
    flow_stages: [row.stage],
    ...patch
  }
}

export function brainTask(id: string, title = `brain ${id}`): Task {
  return {
    id,
    title,
    status: 'x',
    bucket: { idx: 0, name: 'Doing' },
    parent: null,
    dir: 'current',
    readmePath: `/b/${id}/README.md`,
    sessions: []
  }
}

export type FakeWorld = {
  brain?: Task[]
  rows?: TaskRow[]
  done?: TaskRow[]
  ui?: UiFile | null
  details?: Record<string, TaskDetail>
}

export function fakeApi(
  world: FakeWorld,
  over: Partial<Record<keyof RendererApi, Fn>> = {}
): {
  api: RendererApi
  calls: Call[]
  emit(name: string, ...args: unknown[]): void
  world: FakeWorld
} {
  const calls: Call[] = []
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>()
  const ok = <T>(data: T): { ok: true; data: T } => ({ ok: true, data })
  const all = (): TaskRow[] => [...(world.rows ?? []), ...(world.done ?? [])]
  const base: Partial<Record<string, Fn>> = {
    listTasks: async () => ok(world.brain ?? []),
    uiGet: async () => ok(world.ui ?? null),
    uiSet: async (file: never) => ok(file),
    taskList: async ({ scope }: { scope: unknown }) => {
      if (scope === 'attention') return ok(world.rows ?? [])
      if (scope && typeof scope === 'object' && 'ids' in scope) {
        const ids = (scope as { ids: string[] }).ids
        return ok(all().filter((r) => ids.includes(r.id)))
      }
      return ok(world.done ?? [])
    },
    taskGet: async ({ id }: { id: string }) => {
      const row = all().find((r) => r.id === id || r.key === id)
      if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: 'not found' } }
      return ok(world.details?.[row.id] ?? taskDetail(row))
    },
    sessionList: async ({ task_id }: { task_id: string }) =>
      ok(world.details?.[task_id]?.sessions ?? []),
    searchQuery: async () => ok([]),
    taskTypeList: async () => ok([{ id: 'feature', name: 'Feature' }]),
    projectList: async () => ok([]),
    readme: async () => ok('')
  }
  const api = new Proxy({} as RendererApi, {
    get(_, name: string) {
      if (name.startsWith('on'))
        return (cb: (...a: unknown[]) => void) => {
          const set = listeners.get(name) ?? new Set()
          set.add(cb)
          listeners.set(name, set)
          return () => set.delete(cb)
        }
      const fn = (over as Record<string, Fn>)[name] ?? base[name]
      return (...args: unknown[]) => {
        calls.push({ name, args })
        if (fn) return (fn as (...a: unknown[]) => unknown)(...args)
        return Promise.resolve(ok(undefined))
      }
    }
  })
  return {
    api,
    calls,
    world,
    emit: (name, ...args) => listeners.get(name)?.forEach((cb) => cb(...args))
  }
}

/** jsdom não tem ResizeObserver; o Início e o terminal observam o tamanho. */
export function stubResizeObserver(): void {
  const noop = (): void => undefined
  globalThis.ResizeObserver ??= class {
    observe = noop
    unobserve = noop
    disconnect = noop
  } as unknown as typeof ResizeObserver
}
