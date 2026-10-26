import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import { VAULT_COPY } from '../../shared/copy/vault'
import { debugTarget } from '../debug'
import type { Channel } from '../../shared/ipc/define'
import { err, ok, type ErrCode, type Result } from '../../shared/ipc/result'

export type IpcLike = Pick<IpcMain, 'handle' | 'on'>

// Erro de domínio com código: o handler lança, o Result sai com o código certo.
export class IpcError extends Error {
  constructor(
    readonly code: ErrCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
  }
}

type Opts = { validateOutput?: boolean; log?: (msg: string) => void }
export type Handler<C extends Channel> = (
  input: z.output<C['input']>,
  e: IpcMainInvokeEvent | IpcMainEvent
) => Promise<z.input<C['output']>> | z.input<C['output']>

/** O `handle` já amarrado ao ipc e às opções: é o que os `registerXxxIpc` recebem. */
export type Register = <C extends Channel>(ch: C, fn: Handler<C>) => void

const debugLog = (msg: string): void => {
  if (debugTarget()) console.debug(msg)
}

// O renderer manda sempre um único argumento; qualquer coisa a mais é payload inválido.
function parseInput<C extends Channel>(ch: C, args: unknown[]): Result<z.output<C['input']>> {
  if (args.length > 1) return err('VALIDATION', `${ch.name}: argumentos demais (${args.length})`)
  const r = ch.input.safeParse(args[0])
  if (r.success) return ok(r.data)
  return err('VALIDATION', `${ch.name}: ${r.error.issues[0]?.message}`, r.error.issues)
}

// Erro sem código de domínio: a mensagem crua (SQLite, caminho...) vai pro log local, nunca pro renderer.
function toErr(name: string, e: unknown, log: (msg: string) => void): Result<never> {
  if (e instanceof IpcError) return err(e.code, e.message, e.details)
  log(`[ipc] INTERNAL ${name}: ${e instanceof Error ? e.message : String(e)}`)
  return err('INTERNAL', VAULT_COPY.errors.INTERNAL)
}

export function handle<C extends Channel>(
  ipc: IpcLike,
  ch: C,
  fn: Handler<C>,
  opts: Opts = {}
): void {
  const { validateOutput = true, log = debugLog } = opts
  if (ch.kind === 'send') {
    let dropped = 0
    ipc.on(ch.name, (e, ...args) => {
      const input = parseInput(ch, args)
      if (!input.ok) return log(`[ipc] VALIDATION ${input.error.message} (${++dropped})`)
      try {
        Promise.resolve(fn(input.data, e)).catch((x) => log(`[ipc] INTERNAL ${ch.name}: ${x}`))
      } catch (x) {
        log(`[ipc] INTERNAL ${ch.name}: ${x}`)
      }
    })
    return
  }
  ipc.handle(ch.name, async (e, ...args): Promise<Result<z.output<C['output']>>> => {
    const input = parseInput(ch, args)
    if (!input.ok) return input
    try {
      const data = await fn(input.data, e)
      // só confere: devolve o dado original, pra dev e release não divergirem (o parse corta chaves)
      const out = validateOutput ? ch.output.safeParse(data) : null
      if (!out || out.success) return ok(data)
      log(`[ipc] output fora do contrato em ${ch.name}: ${out.error.message}`)
      return err('INTERNAL', `${ch.name}: resposta fora do contrato`, out.error.issues)
    } catch (x) {
      return toErr(ch.name, x, log)
    }
  })
}
