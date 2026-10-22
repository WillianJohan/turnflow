import { useState } from 'react'
import type { Boot } from '../../../../shared/ipc/vault'
import { COPY } from './copy'

export type Screen = 'new_password' | 'words' | 'unlock' | 'recover' | 'failed' | 'app'
export type Mode = 'default' | 'recover'

// O vault conta o mínimo em code points depois do NFC; a tela conta igual.
const length = (s: string): number => [...s.normalize('NFC')].length

export function passwordProblem(a: string, b: string): string | null {
  if (length(a) < 12) return COPY.passwordShort
  if (a !== b) return COPY.passwordMismatch
  return null
}

export function canContinue(saved: boolean, words: string[] | null): boolean {
  return saved && words !== null && words.length === 24
}

/** Qual tela o portão mostra. As palavras vêm do `firstRunBegin`, nunca do `Boot`. */
export function screenFor(b: Boot, mode: Mode, words: string[] | null): Screen {
  switch (b.state) {
    case 'ready':
      return 'app'
    case 'failed':
      return 'failed'
    case 'first_run':
      // chaveiro de verdade dispensa senha: o portão chama firstRunBegin({}) e mostra as palavras
      return words || b.backend === 'real' ? 'words' : 'new_password'
    case 'locked':
      return mode === 'recover' || b.lock !== 'password' ? 'recover' : 'unlock'
  }
}

/** Quanto tempo as palavras copiadas podem ficar no clipboard. */
export const CLIPBOARD_TTL_MS = 60_000

/** Limpa o clipboard só se ele ainda tem `text` (não apaga o que o usuário copiou depois). */
export async function clearClipboardIf(
  text: string,
  read: () => Promise<string | undefined>,
  clear: () => void
): Promise<boolean> {
  if ((await read()) !== text) return false
  clear()
  return true
}

export type Gate = { boot: Boot | null; mode: Mode; fromEvent: boolean }
export type GateAction =
  { t: 'initial' | 'event' | 'result'; boot: Boot } | { t: 'mode'; mode: Mode }
export const initialGate: Gate = { boot: null, mode: 'default', fromEvent: false }

/**
 * Estado do portão. `initial` (o `bootGet` do mount) perde para um `vault.changed` que chegou antes;
 * `result` é a resposta de uma ação (commit, unlock, recover, tentar de novo). Mudou o estado do
 * vault, o modo volta ao default.
 */
export function gateReducer(s: Gate, a: GateAction): Gate {
  if (a.t === 'mode') return { ...s, mode: a.mode }
  if (a.t === 'initial' && s.fromEvent) return s
  const mode = s.boot?.state === a.boot.state ? s.mode : 'default'
  return { boot: a.boot, mode, fromEvent: s.fromEvent || a.t === 'event' }
}

/** Erro de validação do zod chega como "<canal>: <mensagem>"; a tela mostra só a mensagem. */
export function withoutChannel(message: string): string {
  return message.replace(/^[A-Za-z]+[.:][A-Za-z]+: /, '')
}

/** Envio de formulário: `busy` enquanto roda e a mensagem do erro (sem o canal) se falhar. */
export function useSubmit<A extends unknown[]>(
  fn: (...args: A) => Promise<unknown>
): { busy: boolean; error: string | null; submit: (...args: A) => Promise<void> } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (...args: A): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn(...args)
    } catch (e) {
      setError(withoutChannel(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, submit }
}
