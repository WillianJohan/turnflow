import type { IpcErr, Result } from '../../shared/ipc/result'

const logErr = (e: IpcErr): void => console.error(`[ipc] ${e.code}: ${e.message}`, e.details ?? '')

// Default dos canais: erro vai pro console e a chamada devolve undefined.
export async function unwrap<T>(
  p: Promise<Result<T>>,
  report: (e: IpcErr) => void = logErr
): Promise<T | undefined> {
  const r = await p
  if (r.ok) return r.data
  report(r.error)
  return undefined
}

// Pra quem já mostra o erro na tela (.then(ok, fail)): rejeita com a mensagem do main.
export async function orThrow<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p
  if (r.ok) return r.data
  throw new Error(r.error.message)
}
