import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync
} from 'node:fs'
import { join } from 'node:path'
import { BRAND } from '../../shared/brand'
import type { Db } from './open'

export const DAILY_RE = new RegExp(`^${BRAND.id}-\\d{8}\\.db$`)
export const PRE_RE = new RegExp(`^${BRAND.id}-pre-v\\d+-\\d{8}-\\d{6}\\.db$`)

const p2 = (n: number): string => String(n).padStart(2, '0')
const ymd = (d: Date): string => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`
const hms = (d: Date): string => `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`

export const dailyName = (now: Date): string => `${BRAND.id}-${ymd(now)}.db`

export const preMigrationName = (from: number, now: Date): string =>
  `${BRAND.id}-pre-v${from}-${ymd(now)}-${hms(now)}.db`

/**
 * Cópia consistente (inclui o WAL) e cifrada com a mesma chave, via VACUUM INTO.
 * Escreve em `.tmp`, fsync e rename: nunca existe um backup pela metade com o nome final.
 */
export function writeBackup(db: Db, dir: string, name: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700) // mode do mkdir só vale na criação e passa pelo umask
  const final = join(dir, name)
  const tmp = `${final}.tmp`
  rmSync(tmp, { force: true })
  db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`)
  const fd = openSync(tmp, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  chmodSync(tmp, 0o600) // antes do rename: o VACUUM INTO cria com o umask
  renameSync(tmp, final)
  return final
}

/** Cria o backup do dia se faltar (devolve o path) e poda. Já existe: `null`. */
export function ensureDailyBackup(db: Db, dir: string, now: Date): string | null {
  const name = dailyName(now)
  pruneBackups(dir) // tira `.tmp` órfão antes de olhar se o do dia existe
  if (existsSync(join(dir, name))) return null
  const out = writeBackup(db, dir, name)
  pruneBackups(dir)
  return out
}

// A parte final do nome (data, e hora no pré-migration) ordena cronologicamente;
// o `v<N>` do pré-migration não, por isso fica de fora da chave.
const chronoKey = (name: string): string =>
  name.replace(/^.*?(?:-pre-v\d+)?-(\d{8}(?:-\d{6})?)\.db$/, '$1')

/** Remove os mais antigos de cada tipo e qualquer `.tmp`. Nunca toca em `orphan-*`. */
export function pruneBackups(
  dir: string,
  keep: { daily: number; pre: number } = { daily: 7, pre: 3 }
): string[] {
  if (!existsSync(dir)) return []
  const names = readdirSync(dir)
  const removed: string[] = names.filter((n) => n.endsWith('.tmp') && !n.startsWith('orphan-'))
  for (const [re, n] of [
    [DAILY_RE, keep.daily],
    [PRE_RE, keep.pre]
  ] as const) {
    const found = names
      .filter((x) => re.test(x))
      .sort((a, b) => chronoKey(a).localeCompare(chronoKey(b)))
    removed.push(...found.slice(0, Math.max(0, found.length - n)))
  }
  for (const n of removed) rmSync(join(dir, n), { force: true })
  return removed
}

export function scheduleDailyBackup(o: {
  getDb: () => Db | null
  dir: string
  now?: () => Date
  everyMs?: number
  setTimer?: typeof setInterval
  clearTimer?: typeof clearInterval
  log?: (msg: string) => void
}): () => void {
  const now = o.now ?? ((): Date => new Date())
  const setTimer = o.setTimer ?? setInterval
  const clearTimer = o.clearTimer ?? clearInterval
  const tick = (): void => {
    try {
      const db = o.getDb()
      if (db) ensureDailyBackup(db, o.dir, now())
    } catch (e) {
      // erro de FS traz o caminho na mensagem: loga só o código
      const code = (e as { code?: unknown } | null)?.code
      const detail = typeof code === 'string' ? code : e instanceof Error ? e.message : String(e)
      o.log?.(`backup diário falhou: ${detail}`)
    }
  }
  const timer = setTimer(tick, o.everyMs ?? 30 * 60 * 1000)
  // O timer não pode segurar o processo vivo.
  if (typeof timer === 'object') timer.unref?.()
  return () => clearTimer(timer)
}
