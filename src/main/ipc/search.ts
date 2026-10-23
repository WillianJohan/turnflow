import { runSearch } from '../../core/db/search'
import type { Vault } from '../../core/key/vault'
import { searchQuery } from '../../shared/ipc/search'
import { toIpcError } from './vault'
import type { Register } from './handle'

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
