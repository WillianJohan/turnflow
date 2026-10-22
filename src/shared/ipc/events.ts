// Eventos main → renderer. Sem zod: o main é a fonte confiável e o preload não carrega npm.
import type { ConfigState, Task, TaskState } from '../types'

export type Entity = 'task' | 'project' | 'flow' | 'session' | 'activity' | 'confirm'
export type DomainChanged = { entity: Entity; ids: string[]; op: 'upsert' | 'delete' }

// canal → argumentos do evento
export type Events = {
  'tasks:changed': [tasks: Task[]]
  'pty:data': [id: string, data: string]
  'pty:exit': [id: string, code: number]
  'pty:state': [id: string, state: TaskState, info?: { event: string; message?: string }]
  'pty:renamed': [from: string, to: string]
  'config:changed': [state: ConfigState]
  'domain.changed': [change: DomainChanged]
}

// nome no window.turnflow → canal
export const EVENTS = {
  onTasksChanged: 'tasks:changed',
  onData: 'pty:data',
  onExit: 'pty:exit',
  onState: 'pty:state',
  onRenamed: 'pty:renamed',
  onConfig: 'config:changed',
  onDomainChanged: 'domain.changed'
} as const satisfies Record<string, keyof Events>
