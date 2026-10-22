import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { describe, expect, it } from 'vitest'
import { DbOpenError, openDb } from './open'
import { TEST_DEK, openTestDb, tmpDir } from '../testing/db'

const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex')

describe('openDb', () => {
  it('cria cifrado: sem chave não abre e o texto não aparece no arquivo', () => {
    const dir = tmpDir()
    const db = openTestDb(dir)
    db.prepare('insert into secret(name, service, value, created_at) values (?,?,?,?)').run(
      's',
      'svc',
      'marcador-plaintext-42',
      '2026-01-01T00:00:00Z'
    )
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    const file = join(dir, 'turnflow.db')
    const raw = new Database(file)
    expect(() => raw.prepare('select count(*) from sqlite_master').get()).toThrowError(
      expect.objectContaining({ code: 'SQLITE_NOTADB' })
    )
    raw.close()
    expect(readFileSync(file).includes('marcador-plaintext-42')).toBe(false)
  })

  it('chave errada: WRONG_KEY e o arquivo não muda', () => {
    const dir = tmpDir()
    openTestDb(dir).close()
    const file = join(dir, 'turnflow.db')
    const antes = sha(file)
    expect.assertions(3)
    try {
      openDb({ file, dek: randomBytes(32), create: false })
    } catch (e) {
      expect(e).toBeInstanceOf(DbOpenError)
      expect((e as DbOpenError).code).toBe('WRONG_KEY')
    }
    expect(sha(file)).toBe(antes)
  })

  it('pragmas de segurança e WAL', () => {
    const db = openTestDb()
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('secure_delete', { simple: true })).toBe(1)
    db.close()
  })

  it('create:false sem arquivo dá NOT_FOUND e não cria nada', () => {
    const file = join(tmpDir(), 'nao-existe.db')
    expect.assertions(2)
    try {
      openDb({ file, dek: TEST_DEK, create: false })
    } catch (e) {
      expect((e as DbOpenError).code).toBe('NOT_FOUND')
    }
    expect(existsSync(file)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('arquivo nasce com modo 0600', () => {
    const dir = tmpDir()
    openTestDb(dir).close()
    expect(statSync(join(dir, 'turnflow.db')).mode & 0o777).toBe(0o600)
  })

  it('tf_fold some acento e caixa', () => {
    const db = openTestDb()
    expect(db.prepare("select tf_fold('Migração ÇÃ') = 'migracao ca' as ok").get()).toEqual({
      ok: 1
    })
    db.close()
  })

  it('chama instrument depois de abrir', () => {
    let chamado = false
    openDb({
      file: join(tmpDir(), 'i.db'),
      dek: TEST_DEK,
      create: true,
      instrument: () => {
        chamado = true
      }
    }).close()
    expect(chamado).toBe(true)
  })
})
