// Pasta do brain da lateral herdada e cwd das sessões herdadas (Decisão 25). Fica fora do
// config.ts, que importa `electron`, para os testes de integração importarem direto.
// O E6 apaga o leitor herdado (createLegacyBrain) junto com o tasks.ts.
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Task } from '../shared/types'

/** `TURNFLOW_BRAIN` (dev/teste) vence; senão `<brainDir>/tasks` se existir, ou o próprio `brainDir`. */
export function brainTasksDir(env: NodeJS.ProcessEnv, brainDir: string | null): string | null {
  if (env.TURNFLOW_BRAIN) return env.TURNFLOW_BRAIN
  if (!brainDir) return null
  const tasks = join(brainDir, 'tasks')
  return existsSync(tasks) ? tasks : brainDir
}

/** Onde as sessões herdadas, o ⟳ e o resumo abrem: a pasta padrão ou a home. O E5.4 refina por task. */
export function sessionCwd(defaultWorkdir: string | null): string {
  return defaultWorkdir ?? homedir()
}

export type LegacyBrain = {
  setDir(dir: string | null): Promise<void>
  /** Relê a pasta atual e avisa; se o watch não armou, rearma. */
  refresh(): Promise<void>
  list(): Task[]
  root(): string
  close(): void
}

/**
 * Leitor herdado que rearma: trocar de pasta solta o watcher antigo, arma o novo, recarrega e
 * avisa. Mesma pasta = nada. Falha ao ler vai pro `log` e não rejeita (quem chama é a leitura de
 * config, o apply do import e o start).
 */
export function createLegacyBrain(o: {
  watch: (dir: string, onChange: () => void) => () => void
  load: (dir: string) => Promise<Task[]>
  onChanged: (list: Task[]) => void
  log?: (line: string) => void
}): LegacyBrain {
  let dir: string | null = null
  let list: Task[] = []
  let unwatch = (): void => undefined
  let armed = false

  const reload = async (at: string): Promise<void> => {
    try {
      const next = await o.load(at)
      if (dir !== at) return // trocou de pasta enquanto lia: a leitura velha não vale mais
      list = next
      o.onChanged(next)
    } catch (e) {
      o.log?.(`[tasks] brain not loaded: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const arm = (at: string): void => {
    try {
      unwatch = o.watch(at, () => void reload(at))
      armed = true
    } catch (e) {
      armed = false
      o.log?.(`[tasks] brain watch not armed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return {
    async setDir(next) {
      if (next === dir && (next === null || armed)) return
      if (next === dir && next !== null) {
        // mesma pasta com o watch caído: só rearma e relê
        arm(next)
        await reload(next)
        return
      }
      unwatch()
      unwatch = () => undefined
      armed = false
      dir = next
      list = []
      if (next === null) {
        o.onChanged([])
        return
      }
      arm(next)
      await reload(next)
    },
    async refresh() {
      if (dir === null) return
      if (!armed) arm(dir)
      await reload(dir)
    },
    list: () => list,
    root: () => dir ?? '',
    close() {
      unwatch()
      unwatch = () => undefined
      armed = false
      dir = null
    }
  }
}
