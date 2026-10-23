import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { describe, expect, it } from 'vitest'
import { writeBackup } from '../db/backup'
import type { Migration } from '../db/migrate'
import { LATEST, MIGRATIONS } from '../db/migrations'
import { openDb, type Db } from '../db/open'
import { runSearch } from '../db/search'
import { dumpTables, insertCheckpoint, insertTask, tmpDir } from '../testing/db'
import { fakeKeyBackend } from '../testing/fakeKeyBackend'
import type { KeyBackend } from './backend'
import { VaultError, type VaultErrorCode } from './errors'
import { readKeyFile } from './keyfile'
import { vaultPaths } from './paths'
import { dekToWords, wordsToDek } from './recovery'
import { createVault, type Vault, type VaultDeps } from './vault'

const NEW_PASSWORD = 'senha-nova-123'
const TABLES = ['task', 'checkpoint', 'secret', 'flow', 'flow_stage', 'task_type', 'project']
const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex')

async function rejectsWith(p: Promise<unknown>, code: VaultErrorCode): Promise<VaultError> {
  let err: unknown
  try {
    await p
  } catch (e) {
    err = e
  }
  expect(err).toBeInstanceOf(VaultError)
  expect((err as VaultError).code).toBe(code)
  return err as VaultError
}

/** Vault novo num diretório vazio, já em `first_run`. */
async function fresh(
  backend: KeyBackend = fakeKeyBackend('real'),
  extra: Partial<VaultDeps> = {}
): Promise<{
  vault: Vault
  dir: string
}> {
  const dir = tmpDir()
  const vault = createVault({ paths: vaultPaths(dir), backend, ...extra })
  expect(await vault.boot()).toBe('first_run')
  return { vault, dir }
}

/** Nada foi escrito: o diretório continua vazio e o vault continua em `first_run`. */
function expectUntouched(vault: Vault, dir: string): void {
  expect(readdirSync(dir)).toEqual([])
  expect(vault.state()).toBe('first_run')
}

/** Instalação A em `ready` com 3 tasks, checkpoints e um secret. Fica aberta. */
async function installA(): Promise<{ vault: Vault; dir: string; words: string; db: Db }> {
  const { vault, dir } = await fresh()
  const { words } = await vault.beginFirstRun()
  await vault.commitFirstRun()
  const db = vault.db()
  const ids = ['Primeira', 'Segunda', 'Terceira'].map((title, i) =>
    insertTask(db, { key: `T-${i + 1}`, title })
  )
  insertCheckpoint(db, { task_id: ids[0], text: 'parei no gargalo do importador' })
  insertCheckpoint(db, { task_id: ids[1], text: 'esperando revisão' })
  db.prepare(
    "insert into secret(name, service, value, created_at) values ('tok', 'svc', 'valor-x', '2026-10-22')"
  ).run()
  return { vault, dir, words: words.join(' '), db }
}

/** Backup de A num diretório de fora; A continua aberta. */
async function backupOfA(): Promise<{ a: Awaited<ReturnType<typeof installA>>; file: string }> {
  const a = await installA()
  const file = writeBackup(a.db, tmpDir(), 'copia.db')
  return { a, file }
}

describe('restore', () => {
  it('as tasks voltam iguais, a busca acha o checkpoint e o arquivo de origem não muda', async () => {
    const { a, file } = await backupOfA()
    const before = sha(file)
    const { vault: b, dir } = await fresh(fakeKeyBackend('basic_text'))

    await b.restore(file, a.words, NEW_PASSWORD)

    expect(b.state()).toBe('ready')
    expect(dumpTables(b.db(), TABLES)).toEqual(dumpTables(a.db, TABLES))
    expect(runSearch(b.db(), 'gargalo').map((h) => h.kind)).toEqual(['checkpoint'])
    expect(sha(file)).toBe(before)
    expect(existsSync(join(dir, 'restore.tmp'))).toBe(false)
    expect(existsSync(join(dir, 'turnflow.db.init'))).toBe(false)
    b.close()
    a.vault.close()

    // a chave nova (senha) abre o banco restaurado
    const again = createVault({ paths: vaultPaths(dir), backend: fakeKeyBackend('basic_text') })
    expect(await again.boot()).toBe('locked')
    await again.unlockWithPassword(NEW_PASSWORD)
    expect(again.db().prepare('select count(*) as n from task').get()).toEqual({ n: 3 })
    again.close()
  }, 60_000)

  it('palavra errada não sobrescreve nada', async () => {
    const { a, file } = await backupOfA()
    a.vault.close()
    const before = sha(file)
    const { vault: b, dir } = await fresh()
    const words = a.words.split(' ')
    words[4] = 'xyzzy'

    const err = await rejectsWith(b.restore(file, words.join(' ')), 'WORDS_UNKNOWN')

    expect(err.details?.index).toBe(4)
    expectUntouched(b, dir)
    expect(sha(file)).toBe(before)
    b.close()
  })

  it('palavras válidas de outra DEK → WRONG_KEY, nada escrito', async () => {
    const { a, file } = await backupOfA()
    a.vault.close()
    const before = sha(file)
    const { vault: b, dir } = await fresh()

    await rejectsWith(b.restore(file, dekToWords(randomBytes(32)).join(' ')), 'WRONG_KEY')

    expectUntouched(b, dir)
    expect(sha(file)).toBe(before)
    b.close()
  })

  it('backup com -wal: as linhas que só estão no WAL chegam', async () => {
    const a = await installA()
    a.db.pragma('wal_autocheckpoint = 0')
    a.db.pragma('wal_checkpoint(TRUNCATE)')
    insertTask(a.db, { key: 'T-WAL', title: 'Só no WAL' })
    const out = tmpDir()
    const file = join(out, 'aberto.db')
    copyFileSync(join(a.dir, 'turnflow.db'), file)
    copyFileSync(join(a.dir, 'turnflow.db-wal'), `${file}-wal`)
    const shas = [sha(file), sha(`${file}-wal`)]
    const { vault: b } = await fresh()

    await b.restore(file, a.words)

    expect(b.db().prepare("select title from task where key = 'T-WAL'").get()).toEqual({
      title: 'Só no WAL'
    })
    expect([sha(file), sha(`${file}-wal`)]).toEqual(shas)
    expect(readdirSync(out).sort()).toEqual(['aberto.db', 'aberto.db-wal'])
    b.close()
    a.vault.close()
  })

  it('não é backup: texto, vazio e SQLite sem cifra → NOT_A_BACKUP, nada escrito', async () => {
    const words = dekToWords(randomBytes(32)).join(' ')
    const out = tmpDir()
    const text = join(out, 'texto.db')
    writeFileSync(text, 'isto não é um banco\n')
    const empty = join(out, 'vazio.db')
    writeFileSync(empty, '')
    const plain = join(out, 'claro.db')
    const p = new Database(plain)
    p.exec('create table t(x); insert into t values (1)')
    p.close()

    for (const file of [text, empty, plain]) {
      const before = sha(file)
      const { vault, dir } = await fresh()
      await rejectsWith(vault.restore(file, words), 'NOT_A_BACKUP')
      expectUntouched(vault, dir)
      expect(sha(file), file).toBe(before)
      vault.close()
    }
  })

  it('backup mais novo que o app → BACKUP_NEWER com a versão, nada escrito', async () => {
    const { a, file } = await backupOfA()
    a.vault.close()
    const db = openDb({ file, dek: wordsToDek(a.words), create: false, migrate: false })
    db.pragma(`user_version = ${LATEST + 1}`)
    db.close()
    const { vault: b, dir } = await fresh()

    const err = await rejectsWith(b.restore(file, a.words), 'BACKUP_NEWER')

    expect(err.message).toContain(String(LATEST + 1))
    expectUntouched(b, dir)
    b.close()
  })

  it('fora do first_run → BAD_STATE', async () => {
    const { a, file } = await backupOfA()
    await rejectsWith(a.vault.restore(file, a.words), 'BAD_STATE')
    expect(a.vault.state()).toBe('ready')
    a.vault.close()
  })

  it('basic_text sem senha → PASSWORD_REQUIRED, nada escrito', async () => {
    const { a, file } = await backupOfA()
    a.vault.close()
    const { vault: b, dir } = await fresh(fakeKeyBackend('basic_text'))

    await rejectsWith(b.restore(file, a.words), 'PASSWORD_REQUIRED')

    expectUntouched(b, dir)
    b.close()
  })

  it('close() com o restore na fila → LOCKED, nada escrito', async () => {
    const { a, file } = await backupOfA()
    a.vault.close()
    const { vault: b, dir } = await fresh()

    const p = b.restore(file, a.words)
    b.close()

    await rejectsWith(p, 'LOCKED')
    expect(readdirSync(dir)).toEqual([])
  })

  it('close() durante o KDF da senha → LOCKED, nada escrito', async () => {
    const { a, file } = await backupOfA()
    a.vault.close()
    const { vault: b, dir } = await fresh(fakeKeyBackend('basic_text'))

    const p = b.restore(file, a.words, NEW_PASSWORD)
    await new Promise((r) => setTimeout(r, 30)) // já dentro do Argon2
    b.close()

    await rejectsWith(p, 'LOCKED')
    expect(readdirSync(dir)).toEqual([])
  })

  it('senha informada com chaveiro real → modo senha; sem senha → chaveiro', async () => {
    const { a, file } = await backupOfA()
    a.vault.close()
    const withPw = await fresh()
    await withPw.vault.restore(file, a.words, NEW_PASSWORD)
    expect(readKeyFile(join(withPw.dir, 'key.enc'))?.mode).toBe('password')
    withPw.vault.close()
    const noPw = await fresh()
    await noPw.vault.restore(file, a.words)
    expect(readKeyFile(join(noPw.dir, 'key.enc'))?.mode).toBe('keyring')
    noPw.vault.close()
  }, 60_000)

  it('migration que falha no backup antigo → MIGRATION_FAILED, sem backup pré-migration', async () => {
    const dek = randomBytes(32)
    const file = join(tmpDir(), 'antigo.db')
    openDb({ file, dek, create: true, migrations: MIGRATIONS.slice(0, 2) }).close()
    const before = sha(file)
    const broken: Migration = {
      version: LATEST + 1,
      name: 'quebrada',
      up: () => {
        throw new Error('falha de teste')
      }
    }
    const { vault: b, dir } = await fresh(fakeKeyBackend('real'), {
      migrations: [...MIGRATIONS, broken]
    })

    await rejectsWith(b.restore(file, dekToWords(dek).join(' ')), 'MIGRATION_FAILED')

    expectUntouched(b, dir)
    expect(sha(file)).toBe(before)
    b.close()
  })

  it('backup antigo (v2) migra até LATEST e popula a busca', async () => {
    const dek = randomBytes(32)
    const file = join(tmpDir(), 'antigo.db')
    const old = openDb({ file, dek, create: true, migrations: MIGRATIONS.slice(0, 2) })
    const id = insertTask(old, { key: 'T-1', title: 'Tarefa antiga' })
    insertCheckpoint(old, { task_id: id, text: 'anotação do importador' })
    expect(old.pragma('user_version', { simple: true })).toBe(2)
    old.close()
    const { vault: b } = await fresh()

    await b.restore(file, dekToWords(dek).join(' '))

    expect(b.db().pragma('user_version', { simple: true })).toBe(LATEST)
    expect(b.db().prepare('select count(*) as n from search_fts').get()).toEqual({ n: 2 })
    expect(runSearch(b.db(), 'importador').map((h) => h.task_id)).toEqual([id])
    b.close()
  })
})
