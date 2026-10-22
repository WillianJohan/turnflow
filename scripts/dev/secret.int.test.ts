import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LATEST } from '../../src/core/db/migrations'
import { openDb } from '../../src/core/db/open'
import type { KeyBackend } from '../../src/core/key/backend'
import { vaultPaths } from '../../src/core/key/paths'
import { recoveryFileText } from '../../src/core/key/recovery'
import { createVault } from '../../src/core/key/vault'
import { tmpDir } from '../../src/core/testing/db'
import { fakeKeyBackend } from '../../src/core/testing/fakeKeyBackend'
import { runSecretCli, type SecretIo } from './secret'

const PASSWORD = 'senha-correta-123'
const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex')

type Sink = Writable & { text: () => string }
function sink(): Sink {
  const chunks: string[] = []
  const w = new Writable({
    write(c, _e, cb) {
      chunks.push(String(c))
      cb()
    }
  }) as Sink
  w.text = () => chunks.join('')
  return w
}

async function makeVault(
  dir: string,
  backend: KeyBackend,
  password?: string
): Promise<{ words: string[]; wordsFile: string }> {
  const paths = vaultPaths(dir)
  const vault = createVault({ paths, backend })
  await vault.boot()
  const { words } = await vault.beginFirstRun(password)
  await vault.commitFirstRun()
  vault.close()
  const wordsFile = join(dir, 'recovery.txt')
  writeFileSync(wordsFile, recoveryFileText(words, new Date(2026, 9, 22)))
  return { words, wordsFile }
}

function run(
  argv: string[],
  o: { stdin?: string; password?: string; running?: boolean } = {}
): Promise<{ code: number; out: string; err: string; prompts: string[] }> {
  const stdin = new PassThrough()
  stdin.end(o.stdin ?? '')
  const stdout = sink()
  const stderr = sink()
  const prompts: string[] = []
  const io: SecretIo = {
    stdin,
    stdout,
    stderr,
    isTTY: false,
    prompt: async (q) => {
      prompts.push(q)
      return o.password ?? ''
    }
  }
  return runSecretCli(argv, io, {
    appRunning: async () => o.running ?? false,
    now: () => new Date('2026-10-22T12:00:00.000Z')
  }).then((code) => ({ code, out: stdout.text(), err: stderr.text(), prompts }))
}

function rows(dir: string, dek: Buffer): unknown[] {
  const db = openDb({ file: vaultPaths(dir).db, dek, create: false, migrate: false })
  try {
    return db.prepare('select * from secret order by name').all()
  } finally {
    db.close()
  }
}

describe('dev:secret', () => {
  let dir: string
  const OLD = process.env.TURNFLOW_CONFIG_DIR
  beforeEach(() => {
    dir = tmpDir()
    process.env.TURNFLOW_CONFIG_DIR = dir
  })
  afterEach(() => {
    if (OLD === undefined) delete process.env.TURNFLOW_CONFIG_DIR
    else process.env.TURNFLOW_CONFIG_DIR = OLD
    vi.restoreAllMocks()
  })

  const dekOf = async (wordsFile: string): Promise<Buffer> => {
    const { wordsToDek } = await import('../../src/core/key/recovery')
    return wordsToDek(readFileSync(wordsFile, 'utf8'))
  }

  it('set com senha grava o valor e não o imprime', async () => {
    const { wordsFile } = await makeVault(dir, fakeKeyBackend('basic_text'), PASSWORD)
    const r = await run(
      [
        'set',
        'jira',
        '--service',
        'jira',
        '--allow-host',
        'a.example',
        '--allow-host',
        'b.example'
      ],
      { stdin: 'tok-123\n', password: PASSWORD }
    )
    expect(r.code).toBe(0)
    expect(r.out).toBe('segredo jira gravado\n')
    expect(r.out + r.err).not.toContain('tok-123')
    expect(rows(dir, await dekOf(wordsFile))).toEqual([
      {
        name: 'jira',
        service: 'jira',
        value: 'tok-123',
        allow_hosts: '["a.example","b.example"]',
        inject: null,
        created_at: '2026-10-22T12:00:00.000Z',
        last_used_at: null
      }
    ])
  })

  it('set repetido é upsert: uma linha só, valor novo', async () => {
    const { wordsFile } = await makeVault(dir, fakeKeyBackend('basic_text'), PASSWORD)
    await run(['set', 'jira'], { stdin: 'velho\n', password: PASSWORD })
    const r = await run(['set', 'jira'], { stdin: 'novo', password: PASSWORD })
    expect(r.code).toBe(0)
    const all = rows(dir, await dekOf(wordsFile)) as { value: string; allow_hosts: string }[]
    expect(all).toHaveLength(1)
    expect(all[0].value).toBe('novo')
    expect(all[0].allow_hosts).toBe('[]')
  })

  it('list mostra name, service e hosts, nunca o valor', async () => {
    await makeVault(dir, fakeKeyBackend('basic_text'), PASSWORD)
    await run(['set', 'jira', '--service', 'atlassian', '--allow-host', 'x.example'], {
      stdin: 'segredo-do-jira\n',
      password: PASSWORD
    })
    const r = await run(['list'], { password: PASSWORD })
    expect(r.code).toBe(0)
    expect(r.out).toBe('jira atlassian ["x.example"]\n')
    expect(r.out).not.toContain('segredo-do-jira')
  })

  it('senha errada: 1 e Senha incorreta', async () => {
    await makeVault(dir, fakeKeyBackend('basic_text'), PASSWORD)
    const r = await run(['set', 'jira'], { stdin: 'x\n', password: 'senha-errada-999' })
    expect(r.code).toBe(1)
    expect(r.err).toContain('Senha incorreta')
  })

  it('--words-file abre o modo senha sem perguntar a senha', async () => {
    const { wordsFile } = await makeVault(dir, fakeKeyBackend('basic_text'), PASSWORD)
    const r = await run(['set', 'jira', '--words-file', wordsFile], { stdin: 'x' })
    expect(r.code).toBe(0)
    expect(r.prompts).toEqual([])
  })

  it('keyring sem --words-file: 1 e mensagem', async () => {
    await makeVault(dir, fakeKeyBackend('real'))
    const r = await run(['set', 'jira'], { stdin: 'x\n' })
    expect(r.code).toBe(1)
    expect(r.err).toContain('--words-file')
    expect(r.prompts).toEqual([])
  })

  it('keyring com --words-file funciona e não regrava o key.enc', async () => {
    const { wordsFile } = await makeVault(dir, fakeKeyBackend('real'))
    const keyFile = vaultPaths(dir).keyFile
    const before = sha(keyFile)
    const r = await run(['set', 'jira', '--words-file', wordsFile], { stdin: 'tok\n' })
    expect(r.code).toBe(0)
    expect(sha(keyFile)).toBe(before)
    expect(rows(dir, await dekOf(wordsFile))).toHaveLength(1)
  })

  it('app de dev aberto: 1, Feche o app de dev antes, banco não aberto', async () => {
    const { wordsFile } = await makeVault(dir, fakeKeyBackend('real'))
    const r = await run(['set', 'jira', '--words-file', wordsFile], { stdin: 'x', running: true })
    expect(r.code).toBe(1)
    expect(r.err).toContain('Feche o app de dev antes')
    expect(rows(dir, await dekOf(wordsFile))).toEqual([])
  })

  it('sem key.enc: 1 e manda abrir o app', async () => {
    const r = await run(['set', 'jira'], { stdin: 'x' })
    expect(r.code).toBe(1)
    expect(r.err).toContain('Banco de dev não existe: abra o app uma vez')
  })

  it('banco desatualizado: 1 e manda abrir o app para migrar', async () => {
    const { wordsFile } = await makeVault(dir, fakeKeyBackend('real'))
    const db = openDb({
      file: vaultPaths(dir).db,
      dek: await dekOf(wordsFile),
      create: false,
      migrate: false
    })
    db.pragma(`user_version = ${LATEST - 1}`)
    db.close()
    const r = await run(['set', 'jira', '--words-file', wordsFile], { stdin: 'x' })
    expect(r.code).toBe(1)
    expect(r.err).toContain('Banco desatualizado: abra o app uma vez para migrar')
  })

  it('palavras de outro banco: 1 e WRONG_KEY', async () => {
    await makeVault(dir, fakeKeyBackend('real'))
    const other = await makeVault(tmpDir(), fakeKeyBackend('real'))
    const r = await run(['set', 'jira', '--words-file', other.wordsFile], { stdin: 'x' })
    expect(r.code).toBe(1)
    expect(r.err).toContain('Essas palavras não abrem este banco')
  })

  it('valor vazio e argumentos inválidos: 1', async () => {
    expect((await run(['set', 'jira'], { stdin: '\n' })).code).toBe(1)
    expect((await run(['set'])).code).toBe(1)
    expect((await run(['nada'])).code).toBe(1)
  })
})
