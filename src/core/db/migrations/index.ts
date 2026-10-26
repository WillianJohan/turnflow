import type { Migration } from '../migrate'
import { base } from './0001_base'
import { taskCore } from './0002_task_core'
import { search } from './0003_search'
import { domain } from './0004_domain'
import { importSchema } from './0005_import'

export const MIGRATIONS: Migration[] = [base, taskCore, search, domain, importSchema]
export const LATEST: number = Math.max(...MIGRATIONS.map((m) => m.version))
