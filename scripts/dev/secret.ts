import { createReadStream, existsSync, openSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { Writable, type Readable } from 'node:stream'
import { DbOpenError, openDb, type Db } from '../../src/core/db/open'
import { LATEST } from '../../src/core/db/migrations'
import { VaultError } from '../../src/core/key/errors'
import { readKeyFile, unlockDek, type Credential } from '../../src/core/key/keyfile'
import { vaultPaths } from '../../src/core/key/paths'
import { configDir, socketPath } from '../../src/shared/paths'

// Grava/lista segredos na tabela `secret` do banco de DEV, fora do app (o app de dev precisa estar
// fechado). O valor entra só pelo stdin: nunca por argv (vaza em `ps`/histórico) e nunca é impresso.

export type SecretIo = {
  stdin: Readable
  stdout: Writable
  stderr: Writable
  isTTY: boolean
  prompt(question: string, hidden: boolean): Promise<string>
}

export type SecretDeps = {
  env?: NodeJS.ProcessEnv
  appRunning?: () => Promise<boolean>
  now?: () => Date
}

const USAGE =
  'uso: dev:secret set <name> [--service <s>] [--allow-host <h>]... [--words-file <path>]\n' +
  '     dev:secret list [--words-file <path>]'

type Parsed = {
  cmd: 'set' | 'list'
  name?: string
  service?: string
  allowHosts: string[]
  wordsFile?: string
}

class CliError extends Error {}

function parseArgs(argv: string[]): Parsed {
  const [cmd, ...rest] = argv
  if (cmd !== 'set' && cmd !== 'list') throw new CliError(USAGE)
  const out: Parsed = { cmd, allowHosts: [] }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--service' || a === '--allow-host' || a === '--words-file') {
      const v = rest[++i]
      if (v === undefined) throw new CliError(`${a} precisa de um valor`)
      if (a === '--service') out.service = v
      else if (a === '--allow-host') out.allowHosts.push(v)
      else out.wordsFile = v
    } else if (a.startsWith('--')) {
      throw new CliError(`opção desconhecida: ${a}`)
    } else if (cmd === 'set' && out.name === undefined) {
      out.name = a
    } else {
      throw new CliError(USAGE)
    }
  }
  if (cmd === 'set' && !out.name) throw new CliError(USAGE)
  return out
}

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string))
  return Buffer.concat(chunks).toString('utf8')
}

async function readValue(io: SecretIo): Promise<string> {
  const raw = io.isTTY ? await io.prompt('Valor do segredo: ', true) : await readAll(io.stdin)
  const value = io.isTTY ? raw : raw.replace(/\r?\n$/, '')
  if (value === '') throw new CliError('Valor vazio: mande o segredo pelo stdin')
  return value
}

async function credentialFor(
  p: Parsed,
  io: SecretIo,
  mode: 'password' | 'keyring'
): Promise<Credential> {
  if (p.wordsFile) {
    let text: string
    try {
      text = readFileSync(p.wordsFile, 'utf8')
    } catch {
      throw new CliError('Não consegui ler o arquivo das palavras')
    }
    return { words: text }
  }
  if (mode === 'keyring')
    throw new CliError(
      'Banco no modo chaveiro: fora do app só abre com as palavras (--words-file <arquivo salvo>)'
    )
  return { password: await io.prompt('Senha mestra: ', true) }
}

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export async function runSecretCli(
  argv: string[],
  io: SecretIo,
  deps: SecretDeps = {}
): Promise<number> {
  const env = deps.env ?? process.env
  const appRunning =
    deps.appRunning ?? (() => socketAccepts(socketPath(env, process.platform, homedir(), true)))
  const now = deps.now ?? ((): Date => new Date())
  let db: Db | undefined
  let dek: Buffer | undefined
  try {
    const p = parseArgs(argv)
    const value = p.cmd === 'set' ? await readValue(io) : ''
    if (await appRunning()) throw new CliError('Feche o app de dev antes')
    const paths = vaultPaths(configDir(env, process.platform, homedir(), true))
    const keyFile = existsSync(paths.keyFile) ? readKeyFile(paths.keyFile) : null
    if (!keyFile) throw new CliError('Banco de dev não existe: abra o app uma vez')
    dek = await unlockDek(keyFile, await credentialFor(p, io, keyFile.mode))
    try {
      db = openDb({ file: paths.db, dek, create: false, migrate: false })
    } catch (e) {
      if (e instanceof DbOpenError && e.code === 'WRONG_KEY') throw new VaultError('WRONG_KEY')
      if (e instanceof DbOpenError && e.code === 'NOT_FOUND')
        throw new CliError('Banco de dev não existe: abra o app uma vez')
      throw e
    }
    if ((db.pragma('user_version', { simple: true }) as number) < LATEST)
      throw new CliError('Banco desatualizado: abra o app uma vez para migrar')

    if (p.cmd === 'set') {
      db.prepare(
        `insert into secret(name, service, value, allow_hosts, inject, created_at)
         values (?, ?, ?, ?, null, ?)
         on conflict(name) do update set service = excluded.service, value = excluded.value,
           allow_hosts = excluded.allow_hosts, inject = excluded.inject, created_at = excluded.created_at`
      ).run(p.name, p.service ?? p.name, value, JSON.stringify(p.allowHosts), now().toISOString())
      io.stdout.write(`segredo ${p.name} gravado\n`)
    } else {
      const rows = db
        .prepare('select name, service, allow_hosts from secret order by name')
        .all() as { name: string; service: string; allow_hosts: string | null }[]
      for (const r of rows) io.stdout.write(`${r.name} ${r.service} ${r.allow_hosts ?? '[]'}\n`)
    }
    return 0
  } catch (e) {
    io.stderr.write(
      `${e instanceof CliError || e instanceof VaultError || e instanceof DbOpenError ? describe(e) : `Erro inesperado: ${describe(e)}`}\n`
    )
    return 1
  } finally {
    db?.close()
    dek?.fill(0)
  }
}

/** App de dev aberto = alguém aceita conexão no socket dele (≤300 ms). */
function socketAccepts(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect(path)
    const done = (v: boolean): void => {
      s.destroy()
      resolve(v)
    }
    s.setTimeout(300, () => done(false))
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
  })
}

const silent = new Writable({ write: (_c, _e, cb) => cb() })

/** Prompt no terminal (`/dev/tty` quando o stdin traz o valor por pipe); `hidden` não ecoa. */
function ttyPrompt(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin.isTTY ? process.stdin : openTty()
    if (!input) return reject(new CliError('Sem terminal para perguntar: use --words-file'))
    process.stderr.write(question)
    const rl = createInterface({ input, output: hidden ? silent : process.stderr, terminal: true })
    rl.once('line', (line) => {
      rl.close()
      if (hidden) process.stderr.write('\n')
      resolve(line)
    })
    rl.once('close', () => reject(new CliError('Entrada encerrada sem resposta')))
  })
}

function openTty(): Readable | undefined {
  try {
    return createReadStream('', { fd: openSync('/dev/tty', 'r'), autoClose: true })
  } catch {
    return undefined
  }
}

if (process.argv[1]?.endsWith('secret.ts')) {
  void runSecretCli(process.argv.slice(2), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: Boolean(process.stdin.isTTY),
    prompt: ttyPrompt
  }).then((code) => process.exit(code))
}
