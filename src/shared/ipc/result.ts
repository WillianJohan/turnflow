// Todo canal IPC devolve Result: nenhum handler lança exceção através do IPC.
export type ErrCode = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'LOCKED' | 'PENDING' | 'INTERNAL'
export type IpcErr = { code: ErrCode; message: string; details?: unknown }
export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcErr }

export const ok = <T>(data: T): Result<T> => ({ ok: true, data })
export const err = (code: ErrCode, message: string, details?: unknown): Result<never> => ({
  ok: false,
  error: details === undefined ? { code, message } : { code, message, details }
})
