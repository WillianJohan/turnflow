import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
  statSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { VAULT_COPY } from '../../shared/copy/vault'
import { openDb, type Db } from '../db/open'
import { VaultError } from './errors'

// Página do SQLCipher: um backup cifrado sempre tem tamanho múltiplo dela.
const PAGE = 4096
const PLAIN_HEADER = Buffer.from('SQLite format 3\0', 'latin1')

/** Copia `source` para `tmpDir`; o `-wal` vai junto se existir. O original só é lido. */
function copyIn(source: string, tmpDir: string): string {
  let isFile: boolean
  try {
    isFile = statSync(source).isFile()
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError('NOT_A_BACKUP')
    throw e
  }
  if (!isFile) throw new VaultError('NOT_A_BACKUP')
  const copy = join(tmpDir, basename(source))
  copyFileSync(source, copy)
  chmodSync(copy, 0o600)
  if (existsSync(`${source}-wal`)) {
    copyFileSync(`${source}-wal`, `${copy}-wal`)
    chmodSync(`${copy}-wal`, 0o600)
  }
  return copy
}

/**
 * Texto, vazio ou SQLite sem cifra. Precisa vir antes de abrir: o SQLCipher dá o mesmo
 * `SQLITE_NOTADB` para um arquivo qualquer e para um banco de outra chave.
 */
function notABackup(file: string): boolean {
  const { size } = statSync(file)
  if (size === 0 || size % PAGE !== 0) return true
  const head = Buffer.alloc(PLAIN_HEADER.length)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, head, 0, head.length, 0)
  } finally {
    closeSync(fd)
  }
  return head.equals(PLAIN_HEADER)
}

/**
 * Valida o backup e grava em `target` (que não pode existir) uma cópia consistente cifrada com a
 * mesma DEK, ainda sem migrar. Trabalha numa cópia em `tmpDir`, que sai no fim, com ou sem erro.
 * Lança `NOT_A_BACKUP`, `WRONG_KEY` (por `DbOpenError`) ou `BACKUP_NEWER`.
 */
export function extractBackup(o: {
  source: string
  tmpDir: string
  target: string
  dek: Buffer
  latest: number
}): void {
  rmSync(o.tmpDir, { recursive: true, force: true })
  mkdirSync(o.tmpDir, { mode: 0o700 })
  chmodSync(o.tmpDir, 0o700) // o umask pode tirar bits do 0700 do mkdir
  try {
    const copy = copyIn(o.source, o.tmpDir)
    if (notABackup(copy)) throw new VaultError('NOT_A_BACKUP')
    const db: Db = openDb({ file: copy, dek: o.dek, create: false, migrate: false })
    try {
      const version = db.pragma('user_version', { simple: true }) as number
      if (version > o.latest)
        throw new VaultError('BACKUP_NEWER', {
          version,
          message: VAULT_COPY.newerSchema(version, o.latest)
        })
      // VACUUM INTO aplica o WAL da cópia e mantém a cifra e o user_version
      db.exec(`VACUUM INTO '${o.target.replaceAll("'", "''")}'`)
    } finally {
      db.close()
    }
    chmodSync(o.target, 0o600)
    const fd = openSync(o.target, 'r+')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } finally {
    rmSync(o.tmpDir, { recursive: true, force: true })
  }
}
