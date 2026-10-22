import { existsSync, writeFileSync } from 'node:fs'
import Database from 'better-sqlite3-multiple-ciphers'
import { DbOpenError } from './errors'
import { fold } from './fold'
import { migrate, type Migration } from './migrate'
import { MIGRATIONS } from './migrations'

export { DbOpenError }
export type Db = import('better-sqlite3-multiple-ciphers').Database

export type OpenOpts = {
  file: string
  dek: Buffer
  create: boolean
  migrations?: Migration[]
  migrate?: boolean
  beforeMigrate?: (db: Db, from: number, to: number) => void
  instrument?: (db: Db) => void
}

/** Pragma da chave crua (256 bits). Só para open.ts e testes; nunca logar. */
export const keyPragma = (dek: Buffer): string => `key="x'${dek.toString('hex')}'"`

export function openDb(o: OpenOpts): Db {
  if (o.dek.length !== 32) throw new Error('openDb: a DEK precisa ter 32 bytes')
  const exists = existsSync(o.file)
  if (!exists && !o.create) throw new DbOpenError('NOT_FOUND', 'Banco não encontrado.')
  // Cria vazio com 0600 antes do SQLite; o -wal e o -shm herdam o modo do arquivo principal.
  // 'wx' nunca trunca: se alguém criou o arquivo entre o existsSync e aqui, segue com ele.
  if (!exists) {
    try {
      writeFileSync(o.file, '', { mode: 0o600, flag: 'wx' })
    } catch (e) {
      if ((e as { code?: string }).code !== 'EEXIST') throw e
    }
  }
  const db = new Database(o.file, { fileMustExist: true })
  try {
    db.pragma("cipher='sqlcipher'")
    db.pragma(keyPragma(o.dek))
    db.prepare('select count(*) from sqlite_master').get()
  } catch (e) {
    db.close()
    if ((e as { code?: string }).code === 'SQLITE_NOTADB')
      throw new DbOpenError('WRONG_KEY', 'Chave incorreta para este banco.')
    throw e
  }
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('secure_delete = ON')
    db.function('tf_fold', { deterministic: true }, (s: unknown) =>
      typeof s === 'string' ? fold(s) : s
    )
    if (o.migrate !== false)
      migrate(db, o.migrations ?? MIGRATIONS, (from, to) => o.beforeMigrate?.(db, from, to))
    o.instrument?.(db)
  } catch (e) {
    db.close()
    throw e
  }
  return db
}
