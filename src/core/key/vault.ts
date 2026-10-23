import { randomBytes } from 'node:crypto'
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
import { basename, join } from 'node:path'
import { VAULT_COPY } from '../../shared/copy/vault'
import { ensureDailyBackup, preMigrationName, scheduleDailyBackup, writeBackup } from '../db/backup'
import { latestVersion, type Migration } from '../db/migrate'
import { LATEST } from '../db/migrations'
import { DbOpenError, openDb, type Db } from '../db/open'
import type { KeyBackend } from './backend'
import { generateDek } from './dek'
import { VaultError } from './errors'
import {
  readKeyFile,
  unlockDek,
  wrapWithKeyring,
  wrapWithPassword,
  writeKeyFile,
  type KeyFile
} from './keyfile'
import type { VaultPaths } from './paths'
import { dekToWords, wordsToDek } from './recovery'
import { extractBackup } from './restore'

export type VaultState = 'first_run' | 'locked' | 'ready' | 'failed'
export type VaultFailure = {
  code: 'MIGRATION_FAILED' | 'NEWER_SCHEMA' | 'OPEN_FAILED'
  message: string
}
export type VaultDeps = {
  paths: VaultPaths
  backend: KeyBackend
  now?: () => Date
  random?: (n: number) => Buffer
  instrument?: (db: Db) => void
  /** Chamado ao entrar em `ready`. Não deveria lançar: se lançar, o banco fecha e o vault vai a `failed`. */
  onReady?: (db: Db) => void
  onChange?: () => void
  migrations?: Migration[]
  /**
   * Limpeza fora do vault no Apagar tudo (o storage do Chromium, no app). Roda antes de o marcador
   * sair: se falhar, o vault vai a `failed` (`wipeFailed`) e o retry ou o próximo boot refazem.
   */
  clearExternal?: () => Promise<void>
  /** Falha de backup e erro inesperado que vira `OPEN_FAILED`. A linha leva o código do erro, nunca o caminho. */
  log?: (level: 'warn' | 'error', line: string) => void
}
export interface Vault {
  state(): VaultState
  backend(): 'real' | 'basic_text'
  lockReason(): LockReason | null
  failure(): VaultFailure | null
  boot(): Promise<VaultState>
  /** Só em `failed` (o "Tentar de novo"): refaz o boot na fila. Outro estado: `BAD_STATE`. */
  retry(): Promise<VaultState>
  beginFirstRun(password?: string): Promise<{ words: string[] }>
  pendingWords(): string[] | null
  commitFirstRun(): Promise<void>
  unlockWithPassword(password: string): Promise<void>
  recover(words: string, newPassword?: string): Promise<void>
  /**
   * Só em `first_run`: restaura um backup aberto pelas palavras. Erro não deixa nada escrito.
   * Como no `recover`: senha informada → modo senha, mesmo com chaveiro real; sem senha → chaveiro
   * (no `basic_text`, `PASSWORD_REQUIRED`).
   */
  restore(backupPath: string, words: string, password?: string): Promise<void>
  /**
   * Apagar tudo (Decisão 12), de qualquer estado: fecha o banco sem encerrar o vault, grava o
   * `wipe.pending`, apaga o `key.enc` primeiro (crypto-shredding) e depois banco, backups, anexos e
   * logs. Termina em `first_run` no mesmo processo. Interrompido, o próximo `boot()` termina.
   */
  wipeAll(): Promise<void>
  db(): Db
  /** Terminal: depois dele toda operação (inclusive `boot` e `wipeAll`) lança `LOCKED`. */
  close(): void
}

/** `keyring_unavailable` e `keyfile_corrupt`: só as palavras abrem. */
export type LockReason = 'password' | 'keyring_unavailable' | 'keyfile_corrupt'
const DB_SIBLINGS = ['-wal', '-shm'] as const
const p2 = (n: number): string => String(n).padStart(2, '0')
const stamp = (d: Date): string =>
  `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-` +
  `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`

/**
 * Converte qualquer erro em `VaultError`. `DbOpenError` mantém o código (`NOT_FOUND` vira
 * `OPEN_FAILED`) e a mensagem de origem em `details.message`. Erro de FS/SQLite pode trazer o
 * caminho do arquivo: vira `OPEN_FAILED` só com o texto do `VAULT_COPY`, e o rótulo vai pro `log`.
 */
function toVaultError(e: unknown, log?: (line: string) => void): VaultError {
  if (e instanceof VaultError) return e
  if (e instanceof DbOpenError)
    return new VaultError(e.code === 'NOT_FOUND' ? 'OPEN_FAILED' : e.code, {
      message: e.message,
      version: e.details?.version
    })
  log?.(`erro inesperado: ${errorLabel(e)}`)
  return new VaultError('OPEN_FAILED')
}

/** Rótulo de erro para log: o código (errno ou do vault), que não traz caminho. */
function errorLabel(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'erro desconhecido'
}

/** fsync do diretório: a criação/remoção de uma entrada só é durável depois dele. */
function syncDir(dir: string): void {
  let fd: number
  try {
    fd = openSync(dir, 'r')
  } catch {
    return // diretório não abre para leitura (ex.: Windows): o rename/rm já foi feito
  }
  try {
    fsyncSync(fd)
  } catch {
    // alguns sistemas de arquivos não aceitam fsync em diretório
  } finally {
    closeSync(fd)
  }
}

/** Renomeia o banco e os irmãos; o arquivo principal por último (é ele que marca o passo). */
function moveDbFiles(from: string, to: string): void {
  for (const s of DB_SIBLINGS) if (existsSync(from + s)) renameSync(from + s, to + s)
  if (existsSync(from)) renameSync(from, to)
}

export function createVault(deps: VaultDeps): Vault {
  const { paths, backend } = deps
  const now = deps.now ?? ((): Date => new Date())
  const logError = (line: string): void => deps.log?.('error', line)
  const asVaultError = (e: unknown): VaultError => toVaultError(e, logError)
  // Antes do boot nada está aberto: `locked` sem motivo.
  let state: VaultState = 'locked'
  let lock: LockReason | null = null
  let failure: VaultFailure | null = null
  let handle: Db | null = null
  let keyFile: KeyFile | null = null
  let pending: { dek: Buffer; words: string[]; kf: KeyFile } | null = null
  let stopBackups: (() => void) | null = null
  let queue: Promise<unknown> = Promise.resolve()
  // `close()` é síncrono e não entra na fila: uma operação em voo checa isto antes de abrir.
  let closed = false

  function assertNotClosed(): void {
    if (closed) throw new VaultError('LOCKED')
  }

  /** Uma operação por vez: dois unlocks simultâneos não abrem o banco duas vezes. */
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      try {
        assertNotClosed()
        return await fn()
      } catch (e) {
        throw asVaultError(e)
      }
    })
    queue = run.catch(() => undefined)
    return run
  }

  /** `preBackup: false` no restore: a origem já é o backup e nunca muda. */
  function open(
    file: string,
    dek: Buffer,
    create: boolean,
    instrument: boolean,
    preBackup = true
  ): Db {
    assertNotClosed()
    try {
      return openDb({
        file,
        dek,
        create,
        migrations: deps.migrations,
        // Primeiro uso (e restore) começam do zero: backup pré só de banco que já existia.
        // Sem backup pré, a migration não roda: o erro sobe e o vault vai a `failed`.
        beforeMigrate: (db, from) => {
          if (from === 0 || !preBackup) return
          try {
            writeBackup(db, paths.backups, preMigrationName(from, now()))
          } catch (e) {
            deps.log?.('error', `backup pré-migration falhou: ${errorLabel(e)}`)
            throw e
          }
        },
        instrument: instrument ? deps.instrument : undefined
      })
    } catch (e) {
      throw asVaultError(e)
    }
  }

  function settle(next: VaultState, reason: LockReason | null = null): VaultState {
    state = next
    lock = reason
    failure = null
    deps.onChange?.()
    return state
  }

  /** Registra o `failed` e devolve o erro que o chamador lança. */
  function fail(e: VaultError): VaultError {
    const known = e.code === 'MIGRATION_FAILED' || e.code === 'NEWER_SCHEMA'
    const err = known || e.code === 'OPEN_FAILED' ? e : new VaultError('OPEN_FAILED')
    state = 'failed'
    lock = null
    failure = { code: err.code as VaultFailure['code'], message: err.message }
    deps.onChange?.()
    return err
  }

  function enterReady(db: Db): void {
    if (closed) {
      db.close()
      throw new VaultError('LOCKED')
    }
    handle = db
    state = 'ready'
    lock = null
    failure = null
    try {
      ensureDailyBackup(db, paths.backups, now())
    } catch (e) {
      // não impede abrir; o agendador tenta de novo a cada 30 min
      deps.log?.('error', `backup diário falhou: ${errorLabel(e)}`)
    }
    stopBackups ??= scheduleDailyBackup({
      getDb: () => (state === 'ready' ? handle : null),
      dir: paths.backups,
      now,
      log: (line) => deps.log?.('error', line)
    })
    try {
      deps.onReady?.(db)
    } catch (e) {
      logError(`onReady falhou: ${errorLabel(e)}`)
      closeDb()
      throw fail(new VaultError('OPEN_FAILED'))
    }
    deps.onChange?.()
  }

  /** Abre o `turnflow.db`; qualquer erro de abertura vira `failed`. */
  function openReady(dek: Buffer): void {
    assertNotClosed() // fechado com a operação em voo: LOCKED, não failed
    let db: Db
    try {
      db = open(paths.db, dek, false, true)
    } catch (e) {
      throw fail(asVaultError(e))
    }
    enterReady(db)
  }

  function closeDb(): void {
    stopBackups?.()
    stopBackups = null
    if (handle?.open) handle.close()
    handle = null
  }

  function dropPending(): void {
    pending?.dek.fill(0)
    pending = null
  }

  function removeInit(): void {
    if (!existsSync(paths.dir)) return
    const prefix = basename(paths.dbInit)
    for (const n of readdirSync(paths.dir))
      if (n.startsWith(prefix)) rmSync(join(paths.dir, n), { force: true })
  }

  /** Banco sem `key.enc` nunca é apagado: vai para `backups/orphan-<data>/`, onde o Restaurar o acha. */
  function moveOrphan(): void {
    if (![paths.db, ...DB_SIBLINGS.map((s) => paths.db + s)].some((f) => existsSync(f))) return
    mkdirSync(paths.backups, { recursive: true, mode: 0o700 })
    const base = join(paths.backups, `orphan-${stamp(now())}`)
    let target = base
    for (let i = 1; ; i++) {
      try {
        mkdirSync(target, { mode: 0o700 })
        break
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        target = `${base}-${i}`
      }
    }
    chmodSync(target, 0o700) // o umask pode tirar bits do 0700 do mkdir; aqui fica exato
    // irmãos antes do principal: um -wal largado no diretório iria parar no próximo banco
    moveDbFiles(paths.db, join(target, basename(paths.db)))
  }

  /** Marcador durável antes do primeiro `rm`: sem ele, um crash no meio deixaria só metade apagada. */
  function writeWipeMarker(): void {
    ensureDir()
    const fd = openSync(paths.wipeMarker, 'w', 0o600)
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    syncDir(paths.dir)
  }

  /**
   * Apaga o que é do vault, a chave primeiro. Mantém o resto do diretório (`config.json`, `ui.json`,
   * `themes/`, `bin/`, `run/`, `electron/`). O marcador sai por último.
   */
  async function finishWipe(): Promise<void> {
    rmSync(paths.keyFile, { force: true })
    syncDir(paths.dir) // a chave sumiu do disco antes de qualquer outra coisa
    rmSync(paths.keyTmp, { force: true })
    for (const s of DB_SIBLINGS) rmSync(paths.db + s, { force: true }) // -wal antes do banco
    rmSync(paths.db, { force: true })
    removeInit()
    for (const d of [paths.backups, paths.attachments, paths.restoreTmp, paths.logs])
      rmSync(d, { recursive: true, force: true })
    await deps.clearExternal?.()
    rmSync(paths.wipeMarker, { force: true })
    syncDir(paths.dir)
  }

  /** Erro no meio do wipe (permissão, arquivo preso): `failed`; o marcador fica e o próximo boot tenta de novo. */
  async function wipeOrFail(steps: () => Promise<void>): Promise<void> {
    try {
      await steps()
    } catch (e) {
      logError(`apagar tudo falhou: ${errorLabel(e)}`)
      throw fail(new VaultError('OPEN_FAILED', { message: VAULT_COPY.wipeFailed }))
    }
  }

  function ensureDir(): void {
    if (existsSync(paths.dir)) return
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 })
    chmodSync(paths.dir, 0o700) // só no que acabou de ser criado: o umask pode tirar bits do 0700
  }

  function keyringRoundTrips(): boolean {
    const probe = randomBytes(32)
    try {
      return backend.decrypt(backend.encrypt(probe)).equals(probe)
    } catch {
      return false
    }
  }

  function wrapKeyring(dek: Buffer): KeyFile {
    try {
      return wrapWithKeyring(dek, backend)
    } catch (e) {
      if (e instanceof VaultError) throw e
      throw new VaultError('KEYRING_UNAVAILABLE')
    }
  }

  async function bootSteps(): Promise<VaultState> {
    closeDb()
    dropPending()
    keyFile = null
    state = 'locked'
    lock = null
    failure = null
    // Wipe interrompido: termina antes de tudo. O marcador vence a regra do órfão (nada vai para
    // backups/), e um -wal velho não sobra para o banco do próximo primeiro uso.
    if (existsSync(paths.wipeMarker)) {
      await wipeOrFail(finishWipe)
      return settle('first_run')
    }
    let kf: KeyFile | null
    try {
      kf = readKeyFile(paths.keyFile)
    } catch (e) {
      // Corrompido: só as palavras abrem. Outro erro de leitura: a mensagem traria o caminho.
      if (e instanceof VaultError && e.code === 'KEYFILE_CORRUPT')
        return settle('locked', 'keyfile_corrupt')
      logError(`key.enc ilegível: ${errorLabel(e)}`)
      throw fail(new VaultError('OPEN_FAILED'))
    }
    if (!kf) {
      rmSync(paths.keyTmp, { force: true })
      removeInit()
      rmSync(paths.restoreTmp, { recursive: true, force: true })
      moveOrphan()
      return settle('first_run')
    }
    keyFile = kf
    if (!existsSync(paths.db)) {
      // crash entre gravar o key.enc e o rename: o .init já está migrado e fechado
      if (existsSync(paths.dbInit)) moveDbFiles(paths.dbInit, paths.db)
      else throw fail(new VaultError('OPEN_FAILED', { message: VAULT_COPY.dbNotFound }))
    }
    if (kf.mode === 'password') return settle('locked', 'password')
    let dek: Buffer
    try {
      dek = await unlockDek(kf, { keyring: backend })
    } catch (e) {
      if (e instanceof VaultError && e.code === 'KEYRING_UNAVAILABLE')
        return settle('locked', 'keyring_unavailable')
      throw e
    }
    try {
      openReady(dek)
    } finally {
      dek.fill(0)
    }
    return state
  }

  async function runBoot(): Promise<VaultState> {
    try {
      return await bootSteps()
    } catch (e) {
      if (closed) throw e // close() no meio do boot: LOCKED, sem virar failed
      if (state === 'failed') return state
      logError(`boot falhou: ${errorLabel(e)}`)
      fail(new VaultError('OPEN_FAILED'))
      return state
    }
  }

  return {
    state: () => state,
    backend: () => backend.kind(),
    lockReason: () => lock,
    failure: () => (failure ? { ...failure } : null),
    pendingWords: () => (pending ? [...pending.words] : null),

    boot: () => exclusive(runBoot),

    // o check dentro da fila: um unlock/retry na frente já pode ter saído de `failed`
    retry: () =>
      exclusive(async () => {
        if (state !== 'failed') throw new VaultError('BAD_STATE')
        return runBoot()
      }),

    beginFirstRun: (password) =>
      exclusive(async () => {
        if (state !== 'first_run') throw new VaultError('BAD_STATE')
        const real = backend.kind() === 'real'
        if (!real && !password) throw new VaultError('PASSWORD_REQUIRED')
        // Repetir o begin reaproveita a DEK (mesmas palavras) e só troca a senha. Nada vai ao disco.
        const dek = pending?.dek ?? generateDek(deps.random)
        let kf: KeyFile
        try {
          kf = real ? wrapKeyring(dek) : await wrapWithPassword(dek, password as string)
        } catch (e) {
          if (!pending) dek.fill(0)
          throw e
        }
        if (pending) pending.kf = kf
        else pending = { dek, words: dekToWords(dek), kf }
        return { words: [...pending.words] }
      }),

    commitFirstRun: () =>
      exclusive(async () => {
        if (state !== 'first_run' || !pending) throw new VaultError('BAD_STATE')
        const { dek, kf } = pending
        // Decisão 8: .init migrado e fechado → key.enc atômico → rename. O boot resolve cada passo.
        ensureDir()
        removeInit()
        try {
          open(paths.dbInit, dek, true, false).close()
          writeKeyFile(paths.keyFile, kf)
        } catch (e) {
          // com key.enc já gravado o .init é o banco dele: o boot faz o rename
          if (!existsSync(paths.keyFile)) removeInit()
          throw e
        }
        keyFile = kf
        moveDbFiles(paths.dbInit, paths.db)
        try {
          openReady(dek)
        } finally {
          dropPending()
        }
      }),

    unlockWithPassword: (password) =>
      exclusive(async () => {
        if (state !== 'locked' || lock !== 'password' || !keyFile) throw new VaultError('BAD_STATE')
        const dek = await unlockDek(keyFile, { password })
        try {
          openReady(dek)
        } finally {
          dek.fill(0)
        }
      }),

    recover: (words, newPassword) =>
      exclusive(async () => {
        if (state !== 'locked') throw new VaultError('BAD_STATE')
        const dek = wordsToDek(words)
        try {
          // Decisão 9: lock por senha ou senha nova informada → modo senha. Chaveiro só sem senha
          // nova, quando o lock era dele (ou do arquivo corrompido) e a ida e volta funciona.
          let kf: KeyFile
          if (newPassword) kf = await wrapWithPassword(dek, newPassword)
          else if (lock !== 'password' && backend.kind() === 'real' && keyringRoundTrips())
            kf = wrapKeyring(dek)
          else throw new VaultError('PASSWORD_REQUIRED')
          assertNotClosed()
          let db: Db
          try {
            db = open(paths.db, dek, false, true)
          } catch (e) {
            const err = asVaultError(e)
            if (err.code === 'WRONG_KEY') throw err // palavras de outra DEK: segue locked
            throw fail(err)
          }
          try {
            writeKeyFile(paths.keyFile, kf)
          } catch (e) {
            db.close()
            throw e
          }
          keyFile = kf
          enterReady(db)
        } finally {
          dek.fill(0)
        }
      }),

    restore: (backupPath, words, password) =>
      exclusive(async () => {
        if (state !== 'first_run') throw new VaultError('BAD_STATE')
        const dek = wordsToDek(words)
        try {
          if (!password && backend.kind() !== 'real') throw new VaultError('PASSWORD_REQUIRED')
          // O boot do first_run já tirou banco e chave do caminho; o rename abaixo sobrescreveria.
          if (existsSync(paths.keyFile) || existsSync(paths.db)) throw new VaultError('BAD_STATE')
          // Embrulha antes de tocar no disco: falha de chaveiro ou KDF não deixa nada escrito.
          const kf = password ? await wrapWithPassword(dek, password) : wrapKeyring(dek)
          assertNotClosed() // close() durante o KDF: nada vai ao disco
          // Decisão 11: cópia em restore.tmp → .init → mesmo caminho do commitFirstRun.
          ensureDir()
          removeInit()
          try {
            extractBackup({
              source: backupPath,
              tmpDir: paths.restoreTmp,
              target: paths.dbInit,
              dek,
              latest: deps.migrations ? latestVersion(deps.migrations) : LATEST
            })
            open(paths.dbInit, dek, false, false, false).close()
            assertNotClosed()
            writeKeyFile(paths.keyFile, kf)
          } catch (e) {
            rmSync(paths.restoreTmp, { recursive: true, force: true })
            // com key.enc já gravado o .init é o banco dele: o boot faz o rename
            if (!existsSync(paths.keyFile)) removeInit()
            throw e
          }
          keyFile = kf
          moveDbFiles(paths.dbInit, paths.db)
          dropPending()
          openReady(dek)
        } finally {
          dek.fill(0)
        }
      }),

    // closeDb() e não close(): o vault segue vivo e o primeiro uso roda no mesmo processo.
    wipeAll: () =>
      exclusive(async () => {
        closeDb()
        dropPending()
        keyFile = null
        await wipeOrFail(async () => {
          writeWipeMarker()
          await finishWipe()
        })
        settle('first_run')
      }),

    db: () => {
      if (state !== 'ready' || !handle) throw new VaultError('LOCKED')
      return handle
    },

    // Idempotente: o will-quit pode rodar duas vezes.
    close: () => {
      closed = true
      closeDb()
      dropPending()
      if (state === 'ready') state = 'locked'
    }
  }
}
