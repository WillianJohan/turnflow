import type { Migration } from '../migrate'
import { base } from './0001_base'
import { taskCore } from './0002_task_core'

export const MIGRATIONS: Migration[] = [base, taskCore]
export const LATEST: number = Math.max(...MIGRATIONS.map((m) => m.version))
