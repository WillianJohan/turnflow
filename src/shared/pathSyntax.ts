// Sem import de Node: o renderer carrega isto via contracts.ts.

/**
 * Caminho absoluto em qualquer SO: `/…` (posix), `X:\…`/`X:/…` (drive) ou `\\…` (UNC).
 * `C:a` e `\a` dependem da pasta atual: não.
 */
export function isAbsolutePath(s: string): boolean {
  return s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\')
}
