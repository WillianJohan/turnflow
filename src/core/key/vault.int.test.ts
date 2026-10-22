import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { VAULT_COPY } from '../../shared/copy/vault'
import { PRE_RE } from '../db/backup'
import { MIGRATIONS, LATEST } from '../db/migrations'
import type { Migration } from '../db/migrate'
import { openDb, type Db } from '../db/open'
import { tmpDir } from '../testing/db'
import { fakeKeyBackend } from '../testing/fakeKeyBackend'
import type { KeyBackend } from './backend'
import { VaultError, type VaultErrorCode } from './errors'
import { readKeyFile } from './keyfile'
import { vaultPaths, type VaultPaths } from './paths'
import { dekToWords, wordsToDek } from './recovery'
import { createVault, type Vault, type VaultDeps } from './vault'

const PASSWORD = 'senha-correta-123'
const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex')

function vaultAt(
  dir: string,
  backend: KeyBackend,
  extra: Partial<VaultDeps> = {}
): { vault: Vault; paths: VaultPaths } {
  const paths = vaultPaths(dir)
  return { vault: createVault({ paths, backend, ...extra }), paths }
}

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

/** Primeiro uso completo; devolve as palavras e fecha. */
async function committed(
  dir: string,
  backend: KeyBackend,
  password?: string
): Promise<{ words: string[]; paths: VaultPaths }> {
  const { vault, paths } = vaultAt(dir, backend)
  expect(await vault.boot()).toBe('first_run')
  const { words } = await vault.beginFirstRun(password)
  await vault.commitFirstRun()
  expect(vault.state()).toBe('ready')
  vault.close()
  return { words, paths }
}

describe('vault', () => {
  it('keyring real não pede senha', async () => {
    const dir = tmpDir()
    const backend = fakeKeyBackend('real')
    const { vault } = vaultAt(dir, backend)
    expect(await vault.boot()).toBe('first_run')
    expect(vault.backend()).toBe('real')
    const { words } = await vault.beginFirstRun()
    expect(words).toHaveLength(24)
    await vault.commitFirstRun()
    expect(vault.state()).toBe('ready')
    expect(vault.db().prepare('select count(*) as n from flow').get()).toEqual({ n: 0 })
    vault.close()
    expect(readKeyFile(join(dir, 'key.enc'))?.mode).toBe('keyring')
    const again = vaultAt(dir, backend).vault
    expect(await again.boot()).toBe('ready')
    expect(again.lockReason()).toBeNull()
    again.close()
  })

  it('nada no disco antes do commit', async () => {
    const dir = tmpDir()
    const { vault } = vaultAt(dir, fakeKeyBackend('basic_text'))
    await vault.boot()
    await vault.beginFirstRun(PASSWORD)
    expect(vault.pendingWords()).toHaveLength(24)
    expect(readdirSync(dir)).toEqual([])
    const fresh = vaultAt(dir, fakeKeyBackend('basic_text')).vault
    expect(await fresh.boot()).toBe('first_run')
    expect(fresh.pendingWords()).toBeNull()
  })

  it('mesmas palavras ao repetir begin; a senha que vale é a última', async () => {
    const dir = tmpDir()
    const backend = fakeKeyBackend('basic_text')
    const { vault } = vaultAt(dir, backend)
    await vault.boot()
    const first = await vault.beginFirstRun('senha-primeira-1')
    const second = await vault.beginFirstRun(PASSWORD)
    expect(second.words).toEqual(first.words)
    await vault.commitFirstRun()
    vault.close()
    const next = vaultAt(dir, backend).vault
    expect(await next.boot()).toBe('locked')
    await rejectsWith(next.unlockWithPassword('senha-primeira-1'), 'WRONG_PASSWORD')
    await next.unlockWithPassword(PASSWORD)
    expect(next.state()).toBe('ready')
    next.close()
  }, 20_000)

  it('commit cria o diretório com 0700 e o primeiro uso não gera backup pré', async () => {
    const dir = join(tmpDir(), 'config')
    const { paths } = await committed(dir, fakeKeyBackend('real'))
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(existsSync(paths.db)).toBe(true)
    expect(existsSync(paths.dbInit)).toBe(false)
    const backups = existsSync(paths.backups) ? readdirSync(paths.backups) : []
    expect(backups.filter((n) => PRE_RE.test(n))).toEqual([])
  })

  it('entrar em ready faz o backup do dia', async () => {
    const dir = tmpDir()
    const now = (): Date => new Date(2026, 9, 21, 10, 0, 0)
    const { vault, paths } = vaultAt(dir, fakeKeyBackend('real'), { now })
    await vault.boot()
    await vault.beginFirstRun()
    await vault.commitFirstRun()
    expect(readdirSync(paths.backups)).toContain('turnflow-20261021.db')
    vault.close()
  })

  it('beginFirstRun fora do first_run → BAD_STATE; db() fora do ready → LOCKED', async () => {
    const dir = tmpDir()
    const backend = fakeKeyBackend('real')
    const { vault } = vaultAt(dir, backend)
    await vault.boot()
    expect(() => vault.db()).toThrow(expect.objectContaining({ code: 'LOCKED' }))
    await rejectsWith(vault.commitFirstRun(), 'BAD_STATE')
    await vault.beginFirstRun()
    await vault.commitFirstRun()
    await rejectsWith(vault.beginFirstRun(), 'BAD_STATE')
    await rejectsWith(vault.unlockWithPassword(PASSWORD), 'BAD_STATE')
    vault.close()
  })

  it('close idempotente', async () => {
    const dir = tmpDir()
    const { vault } = vaultAt(dir, fakeKeyBackend('real'))
    await vault.boot()
    await vault.beginFirstRun()
    await vault.commitFirstRun()
    vault.close()
    expect(() => vault.close()).not.toThrow()
    expect(() => vault.db()).toThrow(expect.objectContaining({ code: 'LOCKED' }))
  })

  it('key.enc sem banco → failed/OPEN_FAILED', async () => {
    const src = await committed(tmpDir(), fakeKeyBackend('real'))
    const dir = tmpDir()
    copyFileSync(src.paths.keyFile, join(dir, 'key.enc'))
    const { vault } = vaultAt(dir, fakeKeyBackend('real'))
    expect(await vault.boot()).toBe('failed')
    expect(vault.failure()?.code).toBe('OPEN_FAILED')
    expect(vault.failure()?.message).toBe(VAULT_COPY.dbNotFound)
    expect(() => vault.db()).toThrow(expect.objectContaining({ code: 'LOCKED' }))
  })

  it('key.enc ilegível vira OPEN_FAILED sem o caminho na mensagem', async () => {
    const dir = tmpDir()
    mkdirSync(join(dir, 'key.enc'))
    const { vault } = vaultAt(dir, fakeKeyBackend('real'))
    expect(await vault.boot()).toBe('failed')
    expect(vault.failure()).toEqual({ code: 'OPEN_FAILED', message: VAULT_COPY.errors.OPEN_FAILED })
    expect(JSON.stringify(vault.failure())).not.toContain(dir)
  })

  it('dois retries simultâneos depois de falha transitória: um boot só', async () => {
    const dir = tmpDir()
    const backend = fakeKeyBackend('real')
    const { paths } = await committed(dir, backend)
    renameSync(paths.db, `${paths.db}.fora`)
    const instrument = vi.fn()
    const { vault } = vaultAt(dir, backend, { instrument })
    expect(await vault.boot()).toBe('failed')
    renameSync(`${paths.db}.fora`, paths.db)
    const [a, b] = await Promise.allSettled([vault.retry(), vault.retry()])
    expect(a).toEqual({ status: 'fulfilled', value: 'ready' })
    expect((b as PromiseRejectedResult).reason).toMatchObject({ code: 'BAD_STATE' })
    expect(vault.state()).toBe('ready')
    expect(instrument).toHaveBeenCalledTimes(1)
    vault.close()
  }, 20_000)

  it('key.enc ilegível loga o errno, sem o caminho', async () => {
    const dir = tmpDir()
    mkdirSync(join(dir, 'key.enc'))
    const log = vi.fn()
    const { vault } = vaultAt(dir, fakeKeyBackend('real'), { log })
    expect(await vault.boot()).toBe('failed')
    expect(log.mock.calls.map((c) => c[1]).join('\n')).toMatch(/EISDIR/)
    expect(JSON.stringify(log.mock.calls)).not.toContain(dir)
  })

  it('key.enc corrompido → locked/keyfile_corrupt, e as palavras recuperam', async () => {
    const backend = fakeKeyBackend('real')
    const { words, paths } = await committed(tmpDir(), backend)
    writeFileSync(paths.keyFile, '{')
    const { vault } = vaultAt(paths.dir, backend)
    expect(await vault.boot()).toBe('locked')
    expect(vault.lockReason()).toBe('keyfile_corrupt')
    expect(VAULT_COPY.lockReason.keyfile_corrupt).toBe(VAULT_COPY.errors.KEYFILE_CORRUPT)
    await rejectsWith(vault.unlockWithPassword(PASSWORD), 'BAD_STATE')
    await vault.recover(words.join(' '))
    expect(vault.state()).toBe('ready')
    expect(readKeyFile(paths.keyFile)?.mode).toBe('keyring')
    vault.close()
  })

  describe('boot resolve cada estado intermediário do commit', () => {
    const backend = fakeKeyBackend('basic_text')
    // Um commit real fornece o banco migrado e o key.enc que o disco teria em cada passo.
    const files = { db: '', key: '' }
    beforeAll(async () => {
      const src = await committed(tmpDir(), backend, PASSWORD)
      files.db = src.paths.db
      files.key = src.paths.keyFile
    }, 20_000)

    it.each([
      ['{.init}', { init: true }],
      ['{.init, key.enc.tmp}', { init: true, keyTmp: true }]
    ])('%s → first_run e as sobras somem', async (_, o) => {
      const dir = tmpDir()
      const paths = vaultPaths(dir)
      if (o.init) copyFileSync(files.db, paths.dbInit)
      if ('keyTmp' in o) copyFileSync(files.key, paths.keyTmp)
      writeFileSync(`${paths.dbInit}-wal`, 'wal')
      mkdirSync(paths.restoreTmp)
      writeFileSync(join(paths.restoreTmp, 'copia.db'), 'x')
      const { vault } = vaultAt(dir, backend)
      expect(await vault.boot()).toBe('first_run')
      expect(readdirSync(dir)).toEqual([])
    })

    it('{.init, key.enc} → rename, locked e a senha abre', async () => {
      const dir = tmpDir()
      const paths = vaultPaths(dir)
      copyFileSync(files.db, paths.dbInit)
      copyFileSync(files.key, paths.keyFile)
      const { vault } = vaultAt(dir, backend)
      expect(await vault.boot()).toBe('locked')
      expect(vault.lockReason()).toBe('password')
      expect(existsSync(paths.dbInit)).toBe(false)
      expect(existsSync(paths.db)).toBe(true)
      await vault.unlockWithPassword(PASSWORD)
      expect(vault.state()).toBe('ready')
      expect(vault.db().pragma('user_version', { simple: true })).toBe(LATEST)
      vault.close()
    }, 20_000)

    it('{turnflow.db, -wal} sem key.enc → first_run e os arquivos vão para backups/orphan-*', async () => {
      const dir = tmpDir()
      const paths = vaultPaths(dir)
      copyFileSync(files.db, paths.db)
      writeFileSync(`${paths.db}-wal`, 'conteudo-do-wal')
      const before = { db: sha(paths.db), wal: sha(`${paths.db}-wal`) }
      const now = (): Date => new Date(2026, 9, 21, 9, 8, 7)
      const { vault } = vaultAt(dir, backend, { now })
      expect(await vault.boot()).toBe('first_run')
      expect(existsSync(paths.db)).toBe(false)
      expect(existsSync(`${paths.db}-wal`)).toBe(false)
      expect(readdirSync(paths.backups)).toEqual(['orphan-20261021-090807'])
      const orphan = join(paths.backups, 'orphan-20261021-090807')
      expect(sha(join(orphan, 'turnflow.db'))).toBe(before.db)
      expect(sha(join(orphan, 'turnflow.db-wal'))).toBe(before.wal)
      expect(statSync(orphan).mode & 0o777).toBe(0o700)
      // um segundo órfão no mesmo segundo não sobrescreve o primeiro
      copyFileSync(files.db, paths.db)
      expect(await vaultAt(dir, backend, { now }).vault.boot()).toBe('first_run')
      expect(readdirSync(paths.backups)).toHaveLength(2)
      expect(sha(join(orphan, 'turnflow.db'))).toBe(before.db)
    })
  })

  describe('keyring sumiu', () => {
    it('basic_text: recover sem senha nova → PASSWORD_REQUIRED; com senha → ready em modo senha', async () => {
      const { words, paths } = await committed(tmpDir(), fakeKeyBackend('real'))
      const broken = fakeKeyBackend('real', { broken: true })
      const locked = vaultAt(paths.dir, broken).vault
      expect(await locked.boot()).toBe('locked')
      expect(locked.lockReason()).toBe('keyring_unavailable')
      await rejectsWith(locked.unlockWithPassword(PASSWORD), 'BAD_STATE')

      const { vault } = vaultAt(paths.dir, fakeKeyBackend('basic_text', { broken: true }))
      expect(await vault.boot()).toBe('locked')
      expect(vault.lockReason()).toBe('keyring_unavailable')
      const keyBefore = sha(paths.keyFile)
      await rejectsWith(vault.recover(words.join(' ')), 'PASSWORD_REQUIRED')
      expect(sha(paths.keyFile)).toBe(keyBefore)
      await vault.recover(words.join(' '), 'senha-nova-123')
      expect(vault.state()).toBe('ready')
      expect(readKeyFile(paths.keyFile)?.mode).toBe('password')
      vault.close()
    }, 20_000)

    it('real ainda quebrado e sem senha nova → PASSWORD_REQUIRED e o key.enc não muda', async () => {
      const { words, paths } = await committed(tmpDir(), fakeKeyBackend('real'))
      const { vault } = vaultAt(paths.dir, fakeKeyBackend('real', { broken: true }))
      expect(await vault.boot()).toBe('locked')
      const keyBefore = sha(paths.keyFile)
      await rejectsWith(vault.recover(words.join(' ')), 'PASSWORD_REQUIRED')
      expect(sha(paths.keyFile)).toBe(keyBefore)
      expect(vault.state()).toBe('locked')
    })

    it('real que voltou a funcionar: recover reembrulha no chaveiro', async () => {
      const { words, paths } = await committed(tmpDir(), fakeKeyBackend('real'))
      writeFileSync(paths.keyFile, '{')
      const { vault } = vaultAt(paths.dir, fakeKeyBackend('real'))
      expect(await vault.boot()).toBe('locked')
      await vault.recover(words.join(' '))
      expect(readKeyFile(paths.keyFile)?.mode).toBe('keyring')
      vault.close()
    })
  })

  it('palavras válidas de outra DEK → WRONG_KEY e o key.enc não muda', async () => {
    const { paths } = await committed(tmpDir(), fakeKeyBackend('real'))
    const { vault } = vaultAt(paths.dir, fakeKeyBackend('real', { broken: true }))
    await vault.boot()
    const keyBefore = sha(paths.keyFile)
    const other = dekToWords(Buffer.alloc(32, 9)).join(' ')
    await rejectsWith(vault.recover(other, 'senha-nova-123'), 'WRONG_KEY')
    expect(sha(paths.keyFile)).toBe(keyBefore)
    expect(vault.state()).toBe('locked')
    expect(() => vault.db()).toThrow(expect.objectContaining({ code: 'LOCKED' }))
  }, 20_000)

  it('migration quebrada → failed com a mensagem e backup pré-migration', async () => {
    const backend = fakeKeyBackend('basic_text')
    const { paths } = await committed(tmpDir(), backend, PASSWORD)
    const broken: Migration = {
      version: LATEST + 1,
      name: 'quebrada',
      up: () => {
        throw new Error('Falha na migração de teste')
      }
    }
    const onChange = vi.fn()
    const { vault } = vaultAt(paths.dir, backend, {
      migrations: [...MIGRATIONS, broken],
      onChange
    })
    expect(await vault.boot()).toBe('locked')
    const err = await rejectsWith(vault.unlockWithPassword(PASSWORD), 'MIGRATION_FAILED')
    expect(vault.state()).toBe('failed')
    expect(vault.failure()?.code).toBe('MIGRATION_FAILED')
    expect(vault.failure()?.message).toContain('Falha na migração')
    expect(vault.failure()?.message).toContain(`migration ${LATEST + 1} (quebrada)`)
    expect(err.message).toBe(vault.failure()?.message)
    expect(err.details?.message).toBe(vault.failure()?.message)
    expect(readdirSync(paths.backups).filter((n) => PRE_RE.test(n))).toHaveLength(1)
    expect(() => vault.db()).toThrow(expect.objectContaining({ code: 'LOCKED' }))
    expect(onChange).toHaveBeenCalledTimes(2) // boot (locked) e failed
    vault.close()
  }, 20_000)

  it('banco mais novo → failed/NEWER_SCHEMA com versão encontrada e suportada', async () => {
    const backend = fakeKeyBackend('real')
    const { words, paths } = await committed(tmpDir(), backend)
    const raw = openDb({
      file: paths.db,
      dek: wordsToDek(words.join(' ')),
      create: false,
      migrate: false
    })
    raw.pragma('user_version = 99')
    raw.close()
    const { vault } = vaultAt(paths.dir, backend)
    expect(await vault.boot()).toBe('failed')
    expect(vault.failure()).toEqual({
      code: 'NEWER_SCHEMA',
      message: VAULT_COPY.newerSchema(99, LATEST)
    })
  })

  it('onChange em cada transição e onReady(db) ao entrar em ready', async () => {
    const dir = tmpDir()
    const backend = fakeKeyBackend('real')
    const onChange = vi.fn()
    const onReady = vi.fn()
    const { vault } = vaultAt(dir, backend, { onChange, onReady })
    await vault.boot()
    expect(onChange).toHaveBeenCalledTimes(1)
    await vault.beginFirstRun()
    expect(onChange).toHaveBeenCalledTimes(1)
    await vault.commitFirstRun()
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith(vault.db())
    vault.close()

    const instrument = vi.fn()
    const next = vaultAt(dir, backend, { onChange, onReady, instrument }).vault
    await next.boot()
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(onReady).toHaveBeenCalledTimes(2)
    expect(instrument).toHaveBeenCalledWith(next.db())
    next.close()
  })

  describe('concorrência e close', () => {
    const backend = fakeKeyBackend('basic_text')
    let dir = ''
    beforeAll(async () => {
      dir = (await committed(tmpDir(), backend, PASSWORD)).paths.dir
    }, 20_000)

    it('dois unlocks simultâneos: um ready, outro BAD_STATE, banco aberto 1x', async () => {
      const instrument = vi.fn()
      const { vault } = vaultAt(dir, backend, { instrument })
      await vault.boot()
      const [a, b] = await Promise.allSettled([
        vault.unlockWithPassword(PASSWORD),
        vault.unlockWithPassword(PASSWORD)
      ])
      expect(a.status).toBe('fulfilled')
      expect(b.status).toBe('rejected')
      expect((b as PromiseRejectedResult).reason).toMatchObject({ code: 'BAD_STATE' })
      expect(vault.state()).toBe('ready')
      expect(instrument).toHaveBeenCalledTimes(1)
      vault.close()
    }, 20_000)

    it('retry fora de failed → BAD_STATE; concorrente com unlock não derruba o ready', async () => {
      const instrument = vi.fn()
      const { vault } = vaultAt(dir, backend, { instrument })
      await vault.boot()
      const [u, r] = await Promise.allSettled([vault.unlockWithPassword(PASSWORD), vault.retry()])
      expect(u.status).toBe('fulfilled')
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'BAD_STATE' })
      expect(vault.state()).toBe('ready')
      expect(instrument).toHaveBeenCalledTimes(1)
      vault.close()
    }, 20_000)

    it('close com unlock em voo: nenhum banco aberto e db() lança', async () => {
      const instrument = vi.fn()
      const onReady = vi.fn()
      const { vault } = vaultAt(dir, backend, { instrument, onReady })
      await vault.boot()
      const inFlight = vault.unlockWithPassword(PASSWORD)
      // espera o Argon2 começar (~0,6 s com o KDF padrão): o close chega com a operação em voo
      await new Promise((r) => setTimeout(r, 100))
      vault.close()
      await rejectsWith(inFlight, 'LOCKED')
      expect(instrument).not.toHaveBeenCalled()
      expect(onReady).not.toHaveBeenCalled()
      expect(vault.state()).not.toBe('ready')
      expect(() => vault.db()).toThrow(expect.objectContaining({ code: 'LOCKED' }))
      await rejectsWith(vault.unlockWithPassword(PASSWORD), 'LOCKED')
    }, 20_000)

    it('close depois do ready: state() deixa de ser ready', async () => {
      const { vault } = vaultAt(dir, backend)
      await vault.boot()
      await vault.unlockWithPassword(PASSWORD)
      vault.close()
      expect(vault.state()).toBe('locked')
    }, 20_000)
  })

  describe('recover escolhe o modo (Decisão 9)', () => {
    it('lock por senha com chaveiro real funcionando: exige senha nova e fica em modo senha', async () => {
      const { words, paths } = await committed(tmpDir(), fakeKeyBackend('basic_text'), PASSWORD)
      const { vault } = vaultAt(paths.dir, fakeKeyBackend('real'))
      expect(await vault.boot()).toBe('locked')
      expect(vault.lockReason()).toBe('password')
      await rejectsWith(vault.recover(words.join(' ')), 'PASSWORD_REQUIRED')
      await vault.recover(words.join(' '), 'senha-nova-123')
      expect(readKeyFile(paths.keyFile)?.mode).toBe('password')
      vault.close()
    }, 20_000)

    it('key.enc corrompido com senha nova: modo senha mesmo com o chaveiro real', async () => {
      const { words, paths } = await committed(tmpDir(), fakeKeyBackend('real'))
      writeFileSync(paths.keyFile, '{')
      const { vault } = vaultAt(paths.dir, fakeKeyBackend('real'))
      await vault.boot()
      await vault.recover(words.join(' '), 'senha-nova-123')
      expect(readKeyFile(paths.keyFile)?.mode).toBe('password')
      vault.close()
    }, 20_000)
  })

  describe('falhas laterais', () => {
    it('backup do dia que falha é logado sem caminho e não impede o ready', async () => {
      const dir = tmpDir()
      writeFileSync(join(dir, 'backups'), 'não é diretório')
      const log = vi.fn()
      const { vault } = vaultAt(dir, fakeKeyBackend('real'), { log })
      await vault.boot()
      await vault.beginFirstRun()
      await vault.commitFirstRun()
      expect(vault.state()).toBe('ready')
      expect(log).toHaveBeenCalledTimes(1)
      const [level, line] = log.mock.calls[0]
      expect(level).toBe('error')
      expect(line).toMatch(/backup diário falhou: E[A-Z]+/)
      expect(line).not.toContain(dir)
      vault.close()
    })

    it('backup pré-migration que falha é logado e a migration não roda', async () => {
      const backend = fakeKeyBackend('real')
      const { paths } = await committed(tmpDir(), backend)
      rmSync(paths.backups, { recursive: true, force: true })
      writeFileSync(paths.backups, 'não é diretório')
      const extra: Migration = {
        version: LATEST + 1,
        name: 'nova',
        up: (db) => db.exec('create table x(a)')
      }
      const log = vi.fn()
      const { vault } = vaultAt(paths.dir, backend, { migrations: [...MIGRATIONS, extra], log })
      expect(await vault.boot()).toBe('failed')
      expect(vault.failure()?.code).toBe('OPEN_FAILED')
      expect(log.mock.calls.map((c) => c[1]).join('\n')).toMatch(
        /backup pré-migration falhou: E[A-Z]+/
      )
      expect(JSON.stringify(log.mock.calls)).not.toContain(paths.dir)
    })

    it('onReady que lança: banco fechado e estado failed', async () => {
      const instrumented: Db[] = []
      const { vault } = vaultAt(tmpDir(), fakeKeyBackend('real'), {
        instrument: (db) => instrumented.push(db),
        onReady: () => {
          throw new Error('consumidor quebrou')
        }
      })
      await vault.boot()
      await vault.beginFirstRun()
      await rejectsWith(vault.commitFirstRun(), 'OPEN_FAILED')
      expect(vault.state()).toBe('failed')
      expect(instrumented).toHaveLength(1)
      expect(instrumented[0].open).toBe(false)
      expect(() => vault.db()).toThrow(expect.objectContaining({ code: 'LOCKED' }))
    })

    it('onReady que lança: o rótulo do erro vai pro log, sem a mensagem crua', async () => {
      const log = vi.fn()
      const { vault } = vaultAt(tmpDir(), fakeKeyBackend('real'), {
        log,
        onReady: () => {
          throw Object.assign(new Error('/caminho/secreto'), { code: 'EBOOM' })
        }
      })
      await vault.boot()
      await vault.beginFirstRun()
      await rejectsWith(vault.commitFirstRun(), 'OPEN_FAILED')
      expect(log.mock.calls.map((c) => c[1]).join('\n')).toMatch(/EBOOM/)
      expect(JSON.stringify(log.mock.calls)).not.toContain('/caminho/secreto')
    })

    it('erro inesperado numa operação vira OPEN_FAILED e loga só o rótulo', async () => {
      const log = vi.fn()
      const { vault } = vaultAt(tmpDir(), fakeKeyBackend('real'), {
        log,
        random: () => {
          throw Object.assign(new Error('/caminho/secreto'), { code: 'ERAND' })
        }
      })
      await vault.boot()
      await rejectsWith(vault.beginFirstRun(), 'OPEN_FAILED')
      expect(log.mock.calls.map((c) => c[1]).join('\n')).toMatch(/ERAND/)
      expect(JSON.stringify(log.mock.calls)).not.toContain('/caminho/secreto')
    })

    it('begin com senha curta zera a DEK nova', async () => {
      const dek = Buffer.alloc(32, 5)
      const { vault } = vaultAt(tmpDir(), fakeKeyBackend('basic_text'), { random: () => dek })
      await vault.boot()
      await rejectsWith(vault.beginFirstRun('curta'), 'PASSWORD_TOO_SHORT')
      expect(dek.equals(Buffer.alloc(32))).toBe(true)
    })
  })
})
