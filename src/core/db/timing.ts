import type { Db } from './open'

export type Bucket = '<1' | '1-4' | '4-16' | '16-50' | '>50'
export type QueryStat = {
  name: string
  count: number
  totalMs: number
  maxMs: number
  buckets: Record<Bucket, number>
}
export type QueryTimer = {
  record(sql: string, ms: number): void
  stats(): QueryStat[]
  reset(): void
}

const NAME_MAX = 80
const KEY_PRAGMA = /^\s*PRAGMA\s+(re)?key\b/i

const bucketOf = (ms: number): Bucket =>
  ms < 1 ? '<1' : ms < 4 ? '1-4' : ms < 16 ? '4-16' : ms <= 50 ? '16-50' : '>50'

const emptyBuckets = (): Record<Bucket, number> => ({
  '<1': 0,
  '1-4': 0,
  '4-16': 0,
  '16-50': 0,
  '>50': 0
})

/** Só o texto da query entra no log e nas estatísticas; parâmetros nunca passam por aqui. */
export function createQueryTimer(o: {
  mode: 'dev' | 'prod'
  log: (level: 'warn' | 'error', line: string) => void
}): QueryTimer {
  const byName = new Map<string, QueryStat>()
  return {
    record(sql, ms) {
      const name = sql.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
      if (KEY_PRAGMA.test(name)) return
      let s = byName.get(name)
      if (!s) {
        s = { name, count: 0, totalMs: 0, maxMs: 0, buckets: emptyBuckets() }
        byName.set(name, s)
      }
      s.count++
      s.totalMs += ms
      s.maxMs = Math.max(s.maxMs, ms)
      s.buckets[bucketOf(ms)]++
      const line = `[db] ${ms.toFixed(1)}ms ${name}`
      if (ms > 50) o.log('error', line)
      else if (o.mode === 'dev' && ms > 16) o.log('warn', line)
    },
    stats: () => [...byName.values()].sort((a, b) => b.totalMs - a.totalMs),
    reset: () => byName.clear()
  }
}

/** Embrulha `db.prepare`: run/get/all/iterate de cada statement passam pelo timer. */
export function instrumentDb(
  db: Db,
  timer: QueryTimer,
  now: () => number = () => performance.now()
): void {
  const prepare = db.prepare.bind(db) as (sql: string) => ReturnType<Db['prepare']>
  db.prepare = ((sql: string) => {
    const st = prepare(sql)
    for (const m of ['run', 'get', 'all'] as const) {
      const orig = (st[m] as (...a: unknown[]) => unknown).bind(st)
      ;(st as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => {
        const t0 = now()
        try {
          return orig(...args)
        } finally {
          timer.record(sql, now() - t0)
        }
      }
    }
    const iter = (st.iterate as (...a: unknown[]) => IterableIterator<unknown>).bind(st)
    ;(st as unknown as Record<string, unknown>).iterate = function* (...args: unknown[]) {
      const t0 = now()
      try {
        yield* iter(...args)
      } finally {
        timer.record(sql, now() - t0)
      }
    }
    return st
  }) as Db['prepare']
}
