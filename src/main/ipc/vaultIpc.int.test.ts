import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { BRAND } from '../../shared/brand'
import { VAULT_COPY } from '../../shared/copy/vault'
import type { Channel } from '../../shared/ipc/define'
import { CHANNELS } from '../../shared/ipc/registry'
import type { Boot } from '../../shared/ipc/vault'
import { MIGRATIONS, LATEST } from '../../core/db/migrations'
import type { Migration } from '../../core/db/migrate'
import { tmpDir } from '../../core/testing/db'
import { fakeKeyBackend } from '../../core/testing/fakeKeyBackend'
import { vaultPaths } from '../../core/key/paths'
import { createVault, type Vault, type VaultDeps } from '../../core/key/vault'
import { handle, type Handler, type IpcLike } from './handle'
import { registerVaultIpc, wireVaultEvents, type VaultDialogs } from './vault'

const PASSWORD = 'senha-correta-123'
const VERSION = '1.2.3'
const NOW = new Date(2026, 9, 22, 10, 0, 0)

type Invoke = (name: string, ...args: unknown[]) => Promise<unknown>

// ipcMain de mentira: guarda os handlers pra chamar como o Electron chamaria
function fakeIpc(): IpcLike & { invoke: Invoke } {
  const invokes = new Map<string, (...a: unknown[]) => unknown>()
  const event = { sender: { id: 1 } }
  return {
    handle: (name: string, fn: (...a: never[]) => unknown) => void invokes.set(name, fn as never),
    on: () => undefined as never,
    invoke: async (name: string, ...args: unknown[]) => invokes.get(name)!(event, ...args)
  } as never
}

function setup(o: { dir?: string; extra?: Partial<VaultDeps>; dialogs?: VaultDialogs } = {}): {
  vault: Vault
  invoke: Invoke
  dialogs: VaultDialogs
  dir: string
} {
  const dir = o.dir ?? tmpDir()
  const vault = createVault({
    paths: vaultPaths(dir),
    backend: fakeKeyBackend('basic_text'),
    ...o.extra
  })
  const ipc = fakeIpc()
  const dialogs = o.dialogs ?? { save: vi.fn(async () => '/escolhido/chave.txt') }
  const h = <C extends Channel>(ch: C, fn: Handler<C>): void =>
    handle(ipc, ch, fn, { validateOutput: true })
  registerVaultIpc(h, { vault, version: VERSION, dialogs, now: () => NOW })
  return { vault, invoke: ipc.invoke, dialogs, dir }
}

const ch = CHANNELS
const bootOk = (state: Boot['state'], extra: Partial<Boot> = {}): unknown => ({
  ok: true,
  data: { state, backend: 'basic_text', lock: null, failure: null, version: VERSION, ...extra }
})

/** Primeiro uso por IPC até `ready`; devolve as palavras e fecha o vault. */
async function committed(dir: string, extra: Partial<VaultDeps> = {}): Promise<string[]> {
  const { vault, invoke } = setup({ dir, extra })
  await vault.boot()
  const begin = (await invoke(ch.firstRunBegin.name, { password: PASSWORD })) as {
    data: { words: string[] }
  }
  await invoke(ch.firstRunCommit.name, { saved: true })
  vault.close()
  return begin.data.words
}

describe('canais do vault', () => {
  it('boot.get em first_run', async () => {
    const { vault, invoke } = setup()
    await vault.boot()
    expect(await invoke(ch.bootGet.name)).toEqual(bootOk('first_run'))
    vault.close()
  })

  it('begin sem senha no basic_text → VALIDATION', async () => {
    const { vault, invoke } = setup()
    await vault.boot()
    expect(await invoke(ch.firstRunBegin.name, {})).toEqual({
      ok: false,
      error: { code: 'VALIDATION', message: 'Defina uma senha mestra' }
    })
    vault.close()
  })

  it('senha de 11 → VALIDATION pelo zod, handler não chamado', async () => {
    const { vault, invoke } = setup()
    await vault.boot()
    const spy = vi.spyOn(vault, 'beginFirstRun')
    const r = await invoke(ch.firstRunBegin.name, { password: 'ç'.repeat(11) })
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(JSON.stringify(r)).toContain('A senha precisa de pelo menos 12 caracteres')
    expect(spy).not.toHaveBeenCalled()
    vault.close()
  })

  it('senha acima de 1024 code points → VALIDATION; 1024 com emoji passa no contrato', () => {
    const begin = ch.firstRunBegin.input
    expect(begin.safeParse({ password: '😀'.repeat(1024) }).success).toBe(true)
    expect(begin.safeParse({ password: '😀'.repeat(1025) }).success).toBe(false)
    const long = begin.safeParse({ password: '😀'.repeat(1025) })
    expect(long.error?.issues[0]?.message).toBe(VAULT_COPY.passwordTooLong(1024))
    const short = begin.safeParse({ password: 'curta' })
    expect(short.error?.issues[0]?.message).toBe(VAULT_COPY.errors.PASSWORD_TOO_SHORT)
    const empty = ch.vaultUnlock.input.safeParse({ password: '' })
    expect(empty.error?.issues[0]?.message).toBe(VAULT_COPY.passwordEmpty)
    expect(ch.vaultUnlock.input.safeParse({ password: '😀'.repeat(1025) }).success).toBe(false)
    expect(
      ch.vaultRecover.input.safeParse({ words: 'x', newPassword: 'a'.repeat(1025) }).success
    ).toBe(false)
  })

  it('fluxo inteiro: begin → commit(saved:true) → ready; saved:false → VALIDATION', async () => {
    const { vault, invoke } = setup()
    await vault.boot()
    const begin = (await invoke(ch.firstRunBegin.name, { password: PASSWORD })) as {
      ok: true
      data: { words: string[] }
    }
    expect(begin.ok).toBe(true)
    expect(begin.data.words).toHaveLength(24)
    expect(await invoke(ch.firstRunCommit.name, { saved: false })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    expect(vault.state()).toBe('first_run')
    expect(await invoke(ch.firstRunCommit.name, { saved: true })).toEqual(bootOk('ready'))
    expect(await invoke(ch.bootGet.name)).toEqual(bootOk('ready'))
    vault.close()
  }, 20_000)

  it('unlock errado → LOCKED/Senha incorreta e boot.get continua locked', async () => {
    const dir = tmpDir()
    await committed(dir)
    const { vault, invoke } = setup({ dir })
    await vault.boot()
    expect(await invoke(ch.bootGet.name)).toEqual(bootOk('locked', { lock: 'password' }))
    const r = (await invoke(ch.vaultUnlock.name, { password: 'senha-errada-456' })) as {
      ok: false
      error: { code: string; message: string }
    }
    expect(r).toMatchObject({ ok: false, error: { code: 'LOCKED' } })
    expect(r.error.message).toMatch(/^Senha incorreta/)
    expect(await invoke(ch.bootGet.name)).toEqual(bootOk('locked', { lock: 'password' }))
    expect(await invoke(ch.vaultUnlock.name, { password: PASSWORD })).toEqual(bootOk('ready'))
    vault.close()
  }, 30_000)

  it('recover com a 5ª palavra trocada → VALIDATION com details.index 4', async () => {
    const dir = tmpDir()
    const words = await committed(dir)
    const { vault, invoke } = setup({ dir })
    await vault.boot()
    const bad = [...words]
    bad[4] = 'zzzz'
    expect(
      await invoke(ch.vaultRecover.name, { words: bad.join(' '), newPassword: 'outra-senha-789' })
    ).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'A palavra 5 não existe na lista',
        details: { index: 4 }
      }
    })
    expect(
      await invoke(ch.vaultRecover.name, { words: words.join(' '), newPassword: 'outra-senha-789' })
    ).toEqual(bootOk('ready'))
    vault.close()
  }, 30_000)

  it('nenhum Result de erro contém a senha ou as palavras', async () => {
    const dir = tmpDir()
    // DEK fixa: palavra sorteada pode ser trecho de texto fixo ("true", "vault", "word" em password)
    // e o teste ficaria instável; com estas, nenhuma aparece em texto fixo.
    const dek = createHash('sha256').update('leak-b').digest()
    const words = await committed(dir, { random: () => Buffer.from(dek) })
    const { vault, invoke } = setup({ dir })
    await vault.boot()
    const swapped = [...words]
    ;[swapped[0], swapped[1]] = [swapped[1], swapped[0]]
    const unknown = [...words]
    unknown[4] = 'zzzz'
    const wrong = 'senha-errada-456'
    const calls: [string, unknown][] = [
      [ch.vaultUnlock.name, { password: wrong }],
      [ch.vaultUnlock.name, { password: wrong, extra: words.join(' ') }],
      [ch.vaultRecover.name, { words: unknown.join(' '), newPassword: PASSWORD }],
      [ch.vaultRecover.name, { words: swapped.join(' '), newPassword: PASSWORD }],
      [ch.vaultRecover.name, { words: words.slice(0, 23).join(' '), newPassword: PASSWORD }],
      [ch.vaultRecover.name, { words: words.join(' '), newPassword: 'curta' }],
      [ch.vaultRecover.name, { words: words.join(' ') }],
      [ch.firstRunBegin.name, { password: PASSWORD }],
      [ch.firstRunCommit.name, { saved: false }]
    ]
    for (const [name, input] of calls) {
      const r = await invoke(name, input)
      expect(r, name).toMatchObject({ ok: false })
      const json = JSON.stringify(r)
      for (const secret of [wrong, PASSWORD, 'curta', ...words])
        expect(json, `${name} vazou "${secret}"`).not.toContain(secret)
    }
    vault.close()
  }, 60_000)

  it('migration quebrada vira failed', async () => {
    const dir = tmpDir()
    await committed(dir)
    const broken: Migration = {
      version: LATEST + 1,
      name: 'quebrada',
      up: () => {
        throw new Error('Falha na migração de teste')
      }
    }
    const { vault, invoke } = setup({ dir, extra: { migrations: [...MIGRATIONS, broken] } })
    await vault.boot()
    expect(await invoke(ch.vaultUnlock.name, { password: PASSWORD })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' }
    })
    const r = (await invoke(ch.bootGet.name)) as { ok: true; data: Boot }
    expect(r.data.state).toBe('failed')
    expect(r.data.failure?.code).toBe('MIGRATION_FAILED')
    vault.close()
  }, 30_000)

  it('saveWords grava as 24 linhas numeradas pelo dialogs.save; cancelado → null', async () => {
    const save = vi.fn(async () => '/escolhido/chave.txt' as string | null)
    const { vault, invoke } = setup({ dialogs: { save } })
    await vault.boot()
    expect(await invoke(ch.firstRunSaveWords.name)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' }
    })
    expect(save).not.toHaveBeenCalled()
    const begin = (await invoke(ch.firstRunBegin.name, { password: PASSWORD })) as {
      data: { words: string[] }
    }
    expect(await invoke(ch.firstRunSaveWords.name)).toEqual({
      ok: true,
      data: { path: '/escolhido/chave.txt' }
    })
    const [name, text] = save.mock.calls[0] as unknown as [string, string]
    expect(name).toBe(`${BRAND.id}-chave-de-recuperacao.txt`)
    const lines = text.split('\n').filter((l) => /^\d\d /.test(l))
    expect(lines).toEqual(begin.data.words.map((w, i) => `${String(i + 1).padStart(2, '0')} ${w}`))
    expect(text).toContain('2026-10-22')
    save.mockResolvedValueOnce(null)
    expect(await invoke(ch.firstRunSaveWords.name)).toEqual({ ok: true, data: null })
    vault.close()
  }, 20_000)

  it('wireVaultEvents: cada transição emite o Boot igual ao boot.get do momento', async () => {
    const emitted: Boot[] = []
    const atEmit: Promise<unknown>[] = []
    let invoke: Invoke = async () => undefined
    const onChange = wireVaultEvents({
      vault: () => vault,
      version: VERSION,
      broadcast: (b) => {
        emitted.push(b)
        atEmit.push(invoke(ch.bootGet.name)) // o handler roda síncrono: lê o estado de agora
      }
    })
    const s = setup({ extra: { onChange } })
    const vault = s.vault
    invoke = s.invoke
    await vault.boot()
    await invoke(ch.firstRunBegin.name, { password: PASSWORD })
    await invoke(ch.firstRunCommit.name, { saved: true })
    expect(emitted.map((b) => b.state)).toEqual(['first_run', 'ready'])
    const gets = await Promise.all(atEmit)
    expect(gets).toEqual(emitted.map((data) => ({ ok: true, data })))
    vault.close()
  }, 20_000)
})
