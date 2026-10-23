// Tipos compartilhados entre main, preload e renderer.
import type { SessionState } from './contracts'
export type Bucket = { idx: number; name: string }
export type SessionRef = { date: string; uuid: string; desc: string }
export type Dir = 'current' | 'done'
export type Task = {
  id: string
  title: string
  status: string
  bucket: Bucket
  parent: string | null
  dir: Dir
  readmePath: string
  sessions: SessionRef[] // ordem do arquivo: mais recente por último
}
export type TaskState = SessionState
export type Header = { what: string; where: string; next: string }
export type HeaderCache = {
  readmeMtime: number
  jsonlMtime: number
  generatedAt?: number
  header: Header
  error?: string
}
export type Theme = { name: string; ui: Record<string, string>; terminal: Record<string, string> }
export type AppConfig = {
  theme: string
  draftMode: boolean
  notifications: boolean // aviso do sistema quando um claude espera você
  fontSize: number // terminal
  termFont: string
  appFont: string
  appFontSize: number
  statusIcons: Record<string, string>
  /** Pasta de trabalho padrão das tasks sem `workdir` (absoluta) ou `null`. */
  defaultWorkdir: string | null
  /** Pasta do brain do último import (absoluta) ou `null`; a lateral herdada lista dela. */
  brainDir: string | null
  /** Comandos dos agentes que não são o Claude. `other: null` = não configurado. Só pelo arquivo. */
  agents: { codex: string; cursor: string; other: string | null }
}
export type ConfigState = {
  dir: string
  config: AppConfig
  theme: Theme
  themes: { id: string; name: string; builtin?: boolean }[]
  error?: string
}
