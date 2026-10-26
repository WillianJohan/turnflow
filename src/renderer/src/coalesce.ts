/**
 * Junta disparos: roda `run` uma vez `delay` ms depois do último pedido. Pedido que chega com uma
 * rodada no ar marca "suja" e vale uma rodada a mais quando ela termina (nunca duas ao mesmo tempo).
 */
export function coalesce(
  run: () => Promise<unknown>,
  delay: number
): { trigger(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let dirty = false
  let dead = false
  const fire = (): void => {
    timer = undefined
    if (dead) return
    if (running) {
      dirty = true
      return
    }
    running = true
    void run()
      .catch(() => undefined)
      .finally(() => {
        running = false
        if (dirty && !dead) {
          dirty = false
          fire()
        }
      })
  }
  return {
    trigger() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(fire, delay)
    },
    cancel() {
      dead = true
      if (timer) clearTimeout(timer)
    }
  }
}
