import { runSearch } from '../../core/db/search'
import type { Vault } from '../../core/key/vault'
import type { Channel } from '../../shared/ipc/define'
import { searchQuery } from '../../shared/ipc/search'
import { toIpcError } from './vault'
import type { Handler } from './handle'

type Register = <C extends Channel>(ch: C, fn: Handler<C>) => void

export function registerSearchIpc(h: Register, deps: { vault: Vault }): void {
  h(searchQuery, ({ q, limit }) => {
    try {
      // vault.db() lança LOCKED fora de `ready`
      return runSearch(deps.vault.db(), q, limit)
    } catch (e) {
      throw toIpcError(e)
    }
  })
}
