import { z } from 'zod'

// Só entra no build de teste (import atrás de `if (__TURNFLOW_TEST__)`); o release não pode conter nada daqui.

/** Relógio fixo do domínio quando `TURNFLOW_TEST_NOW` traz um ISO válido; senão `null` (relógio real). */
export function testNow(env: NodeJS.ProcessEnv): (() => Date) | null {
  const iso = z.string().datetime().safeParse(env.TURNFLOW_TEST_NOW)
  if (!iso.success) return null
  const ms = Date.parse(iso.data)
  return () => new Date(ms)
}
