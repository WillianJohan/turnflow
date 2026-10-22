import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRAND } from '../../shared/brand'
import { TEST_DEK, dumpTables, insertTask, openTestDb, tmpDir } from '../testing/db'
import {
  DAILY_RE,
  PRE_RE,
  dailyName,
  ensureDailyBackup,
  preMigrationName,
  pruneBackups,
  scheduleDailyBackup,
  writeBackup
} from './backup'
import { openDb, type Db } from './open'
import { LATEST, MIGRATIONS } from './migrations'
import Database from 'better-sqlite3-multiple-ciphers'

const TABLES = ['task', 'flow', 'flow_stage', 'task_type']
const day = (d: number): Date => new Date(2026, 9, d, 12, 0, 0)
const list = (dir: string): string[] => readdirSync(dir).sort()
const touch = (dir: string, name: string): void => writeFileSync(join(dir, name), 'x')

function setup(): { db: Db; dir: string } {
  const db = openTestDb()
  insertTask(db, { key: 'A-1', title: 'um' })
  return { db, dir: join(tmpDir(), 'backups') }
}

describe('nomes', () => {
  it('seguem as regexes e usam data local', () => {
    const d = new Date(2026, 9, 21, 8, 5, 9)
    expect(dailyName(d)).toBe(`${BRAND.id}-20261021.db`)
    expect(preMigrationName(3, d)).toBe(`${BRAND.id}-pre-v3-20261021-080509.db`)
    expect(DAILY_RE.test(dailyName(d))).toBe(true)
    expect(PRE_RE.test(preMigrationName(3, d))).toBe(true)
    expect(DAILY_RE.test(preMigrationName(3, d))).toBe(false)
  })
})

describe('writeBackup', () => {
  it('sai cifrado com a mesma chave', () => {
    const { db, dir } = setup()
    const out = writeBackup(db, dir, dailyName(day(21)))
    expect(statSync(out).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    const raw = new Database(out)
    expect(() => raw.prepare('select count(*) from sqlite_master').get()).toThrowError(
      expect.objectContaining({ code: 'SQLITE_NOTADB' })
    )
    raw.close()
    const copia = openDb({ file: out, dek: TEST_DEK, create: false })
    expect(dumpTables(copia, TABLES)).toEqual(dumpTables(db, TABLES))
    copia.close()
    db.close()
  })

  it('inclui linhas que estão só no WAL', () => {
    const { db, dir } = setup()
    db.pragma('wal_autocheckpoint = 0')
    for (let i = 0; i < 100; i++) insertTask(db, { key: `W-${i}`, title: `t${i}` })
    expect(statSync(db.name + '-wal').size).toBeGreaterThan(0)
    const out = writeBackup(db, dir, dailyName(day(21)))
    const copia = openDb({ file: out, dek: TEST_DEK, create: false })
    expect(copia.prepare("select count(*) as n from task where key like 'W-%'").get()).toEqual({
      n: 100
    })
    copia.close()
    db.close()
  })

  it('escapa aspas simples no caminho', () => {
    const db = openTestDb()
    const dir = join(tmpDir(), "it's")
    const out = writeBackup(db, dir, dailyName(day(21)))
    expect(existsSync(out)).toBe(true)
    db.close()
  })
})

describe('ensureDailyBackup', () => {
  it('tmp órfão não conta', () => {
    const { db, dir } = setup()
    writeBackup(db, dir, 'orphan-x.db')
    touch(dir, `${BRAND.id}-20261021.db.tmp`)
    const out = ensureDailyBackup(db, dir, day(21))
    expect(out).toBe(join(dir, dailyName(day(21))))
    expect(list(dir)).toEqual(['orphan-x.db', dailyName(day(21))])
    db.close()
  })

  it('um por dia', () => {
    const { db, dir } = setup()
    expect(ensureDailyBackup(db, dir, day(21))).not.toBeNull()
    expect(ensureDailyBackup(db, dir, day(21))).toBeNull()
    expect(ensureDailyBackup(db, dir, day(22))).not.toBeNull()
    expect(list(dir)).toHaveLength(2)
    db.close()
  })

  it('mantém 7; orphan-* e pré-migration ficam intocados', () => {
    const { db, dir } = setup()
    const pre = preMigrationName(1, day(1))
    writeBackup(db, dir, 'orphan-y.db')
    writeBackup(db, dir, pre)
    for (let d = 1; d <= 9; d++) ensureDailyBackup(db, dir, day(d))
    const daily = list(dir).filter((n) => DAILY_RE.test(n))
    expect(daily).toEqual([3, 4, 5, 6, 7, 8, 9].map((d) => dailyName(day(d))))
    expect(list(dir)).toContain('orphan-y.db')
    expect(list(dir)).toContain(pre)
    db.close()
  })
})

describe('pruneBackups', () => {
  it('pré-migration mantém 3 (ordena pela data, não por v9 < v10)', () => {
    const dir = tmpDir()
    const nomes = [
      preMigrationName(9, day(1)),
      preMigrationName(10, day(2)),
      preMigrationName(11, day(3)),
      preMigrationName(12, day(4)),
      preMigrationName(13, day(5))
    ]
    for (const n of nomes) touch(dir, n)
    touch(dir, 'orphan-z.db')
    const removed = pruneBackups(dir)
    expect(removed.sort()).toEqual([nomes[0], nomes[1]].sort())
    expect(list(dir)).toEqual([...nomes.slice(2), 'orphan-z.db'].sort())
  })

  it('diretório inexistente não lança', () => {
    expect(pruneBackups(join(tmpDir(), 'nada'))).toEqual([])
  })
})

describe('pré-migration com a migration falhando', () => {
  it('o arquivo pré existe, abre com a DEK e está em LATEST', () => {
    const dir = join(tmpDir(), 'backups')
    const file = join(tmpDir(), 'turnflow.db')
    openDb({ file, dek: TEST_DEK, create: true }).close()
    const quebra = {
      version: LATEST + 1,
      name: 'quebra',
      up: () => {
        throw new Error('boom')
      }
    }
    const now = day(21)
    expect.assertions(4)
    try {
      openDb({
        file,
        dek: TEST_DEK,
        create: false,
        migrations: [...MIGRATIONS, quebra],
        beforeMigrate: (db, from) => writeBackup(db, dir, preMigrationName(from, now))
      })
    } catch (e) {
      expect((e as { code?: string }).code).toBe('MIGRATION_FAILED')
    }
    const pre = join(dir, preMigrationName(LATEST, now))
    expect(existsSync(pre)).toBe(true)
    const copia = openDb({ file: pre, dek: TEST_DEK, create: false, migrate: false })
    expect(copia.pragma('user_version', { simple: true })).toBe(LATEST)
    copia.close()
    expect(existsSync(file)).toBe(true)
  })
})

describe('scheduleDailyBackup', () => {
  function fakeTimers(): {
    setTimer: typeof setInterval
    clearTimer: typeof clearInterval
    tick: () => void
    cleared: () => boolean
  } {
    let cb: (() => void) | null = null
    let cleared = false
    return {
      setTimer: ((fn: () => void) => {
        cb = fn
        return 1
      }) as unknown as typeof setInterval,
      clearTimer: (() => {
        cleared = true
      }) as unknown as typeof clearInterval,
      tick: () => cb?.(),
      cleared: () => cleared
    }
  }

  it('getDb null não faz nada; com banco cruza a meia-noite', () => {
    const { db, dir } = setup()
    const t = fakeTimers()
    let current: Db | null = null
    let now = new Date(2026, 9, 21, 23, 50)
    const stop = scheduleDailyBackup({
      getDb: () => current,
      dir,
      now: () => now,
      setTimer: t.setTimer,
      clearTimer: t.clearTimer
    })
    t.tick()
    expect(existsSync(dir)).toBe(false)
    current = db
    t.tick()
    expect(list(dir)).toEqual([dailyName(new Date(2026, 9, 21))])
    now = new Date(2026, 9, 22, 0, 10)
    t.tick()
    expect(list(dir)).toEqual([dailyName(new Date(2026, 9, 21)), dailyName(now)])
    stop()
    expect(t.cleared()).toBe(true)
    db.close()
  })

  it('getDb que lança vira log, sem exceção', () => {
    const t = fakeTimers()
    const logs: string[] = []
    scheduleDailyBackup({
      getDb: () => {
        throw new Error('quebrou')
      },
      dir: tmpDir(),
      setTimer: t.setTimer,
      clearTimer: t.clearTimer,
      log: (m) => logs.push(m)
    })
    expect(() => t.tick()).not.toThrow()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('quebrou')
  })
})
