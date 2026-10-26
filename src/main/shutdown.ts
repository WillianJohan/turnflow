import type { DomainDeps } from '../core/domain/context'
import { endLiveSessions } from '../core/domain/session'
import type { SessionHost } from './sessionHost'

export type ShutdownStep = { name: string; run(): void | Promise<void> }

/** Roda os passos em ordem. Passo que lança vai para o log. Estourou `totalMs`, resolve. */
export async function runShutdown(
  steps: ShutdownStep[],
  o: { totalMs: number; log(line: string): void }
): Promise<void> {
  let stop = false
  const timer = setTimeout(() => {
    stop = true
  }, o.totalMs)
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, o.totalMs))
  const work = (async (): Promise<void> => {
    for (const step of steps) {
      if (stop) return
      try {
        await step.run()
      } catch (e) {
        o.log(`${step.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  })()
  await Promise.race([work, deadline])
  clearTimeout(timer)
}

export function shutdownPlan(d: {
  host: SessionHost
  domain(): DomainDeps | null
  socket: { close(): Promise<void> } | null
  hooks: { close(): Promise<void> }
  changeBus: { dispose(): void }
  vault: { close(): void }
}): ShutdownStep[] {
  return [
    { name: 'pty', run: () => d.host.killAllAndWait(3000) },
    {
      name: 'sessions',
      run: () => {
        const domain = d.domain()
        if (domain) endLiveSessions(domain)
      }
    },
    { name: 'socket', run: () => d.socket?.close() },
    { name: 'hooks', run: () => d.hooks.close() },
    { name: 'changeBus', run: () => d.changeBus.dispose() },
    { name: 'vault', run: () => d.vault.close() }
  ]
}
