import type { Result } from '../../shared/ipc/result'

// pty:send devolve false quando a sessão já tinha morrido; erro de IPC é outra coisa.
export const sendOutcome = (r: Result<boolean>): 'sent' | 'lost' | 'error' =>
  !r.ok ? 'error' : r.data ? 'sent' : 'lost'
