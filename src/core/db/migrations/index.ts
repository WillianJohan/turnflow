import type { Migration } from '../migrate'
import { base } from './0001_base'
import { taskCore } from './0002_task_core'
import { search } from './0003_search'

export const MIGRATIONS: Migration[] = [base, taskCore, search]
export const LATEST: number = Math.max(...MIGRATIONS.map((m) => m.version))
