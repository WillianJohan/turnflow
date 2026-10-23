import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { CONFIG_COPY } from '../../shared/copy/config'
import type { Channel } from '../../shared/ipc/define'
import { CHANNELS } from '../../shared/ipc/registry'
import { deleteTheme, saveTheme, cloneTheme, writeConfig, ensureDefaults } from '../appConfig'
import { loginEnv, resetLoginEnv } from '../loginEnv'
import { handle, type Handler, type IpcLike } from './handle'

// O renderer recebe a mensagem do erro conhecido, não o INTERNAL genérico.
function invoker<C extends Channel>(ch: C, fn: Handler<C>): (input?: unknown) => Promise<unknown> {
  let registered: ((...a: unknown[]) => unknown) | undefined
  const ipc = {
    handle: (_: string, f: (...a: never[]) => unknown) => void (registered = f as never),
    on: () => undefined
  } as unknown as IpcLike
  handle(ipc, ch, fn, { log: vi.fn() })
  return async (input) => registered!({ sender: { id: 1 } }, input)
}

describe('erros conhecidos chegam ao renderer com o texto útil', () => {
  it('claude fora do PATH → NOT_FOUND com o texto da copy', async () => {
    resetLoginEnv()
    const call = invoker(CHANNELS.readme, async () => {
      await loginEnv(async () => '__TURNFLOW_PATH=/usr/bin\n__TURNFLOW_CLAUDE=\n')
      return { kind: 'new' } as never
    })
    expect(await call({ id: 'T-1' })).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: CONFIG_COPY.claudeNotFound }
    })
    resetLoginEnv()
  })

  it('erros de tema → VALIDATION com o texto da copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
    await ensureDefaults(dir)
    const theme = { name: 'x', ui: { bg: '#000000' }, terminal: {} } as never
    const cases: [() => Promise<unknown>, string][] = [
      [() => saveTheme(dir, '.oculto', theme), CONFIG_COPY.themeNameInvalid('.oculto')],
      [() => saveTheme(dir, 'escuro', theme), CONFIG_COPY.themeBuiltin('escuro')],
      [
        () => saveTheme(dir, 'meu', { ...(theme as object), ui: { bg: 'azul' } } as never),
        CONFIG_COPY.colorInvalid('bg', 'azul')
      ],
      [() => deleteTheme(dir, 'escuro'), CONFIG_COPY.themeNotDeletable('escuro')],
      [() => cloneTheme(dir, '../x'), CONFIG_COPY.themeInvalid('../x')]
    ]
    for (const [fn, message] of cases) {
      const call = invoker(CHANNELS.deleteTheme, async () => {
        await fn()
        return null as never
      })
      expect(await call({ id: 'qualquer' })).toEqual({
        ok: false,
        error: { code: 'VALIDATION', message }
      })
    }
  })

  it('config.json quebrado → VALIDATION com o texto da copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
    const { writeFileSync } = await import('fs')
    writeFileSync(join(dir, 'config.json'), '{quebrado')
    const call = invoker(CHANNELS.deleteTheme, async () => {
      await writeConfig(dir, { draftMode: true })
      return null as never
    })
    expect(await call({ id: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', message: expect.stringMatching(/^config\.json inválido/) }
    })
  })
})
