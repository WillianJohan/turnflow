import type {
  AppConfig,
  ConfigState,
  Theme,
  HeaderCache,
  How,
  Plan,
  SessionInfo,
  Task,
  TaskState
} from '../shared/types'

type Unsub = () => void

export type DkApi = {
  listTasks(): Promise<Task[]>
  onTasksChanged(cb: (tasks: Task[]) => void): Unsub
  plan(taskId: string, uuid?: string): Promise<Plan>
  start(taskId: string, how: How, cols: number, rows: number): Promise<void>
  startUpdate(cols: number, rows: number): Promise<void>
  tasksRoot(): Promise<string>
  readme(taskId: string): Promise<string>
  startScratch(id: string, cols: number, rows: number): Promise<void>
  write(taskId: string, data: string): void
  send(taskId: string, data: string): Promise<boolean>
  resize(taskId: string, cols: number, rows: number): void
  kill(taskId: string): void
  onData(cb: (taskId: string, data: string) => void): Unsub
  onExit(cb: (taskId: string, code: number) => void): Unsub
  onState(
    cb: (taskId: string, state: TaskState, info?: { event: string; message?: string }) => void
  ): Unsub
  focusWindow(): void
  onRenamed(cb: (from: string, to: string) => void): Unsub
  sessionInfo(taskId: string): Promise<SessionInfo[]>
  settingsPath(): Promise<string>
  headerCached(taskId: string): Promise<HeaderCache | null>
  pathForFile(file: File): string
  config(): Promise<ConfigState>
  setConfig(patch: Partial<AppConfig>): Promise<ConfigState>
  cloneTheme(from: string): Promise<ConfigState>
  openConfigDir(): void
  fonts(): Promise<{ all: string[]; mono: string[] }>
  readTheme(id: string): Promise<Theme>
  saveTheme(id: string, theme: Theme): Promise<ConfigState>
  deleteTheme(id: string): Promise<ConfigState>
  onConfig(cb: (s: ConfigState) => void): Unsub
  clipboard: { read(): Promise<{ text: string; image: boolean }>; writeText(t: string): void }
  header(taskId: string, force: boolean): Promise<HeaderCache | null>
}

declare global {
  interface Window {
    dk: DkApi
  }
}
