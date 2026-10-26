// TURNFLOW_DEBUG (arquivo que recebe todo byte dos PTYs, console do renderer, log do IPC) só vale
// em dev e no build de teste: no release a variável é ignorada. O index liga no boot.
let allowed = false

export function allowDebug(on: boolean): void {
  allowed = on
}

export function debugTarget(env: Record<string, string | undefined> = process.env): string | null {
  return allowed && env.TURNFLOW_DEBUG ? env.TURNFLOW_DEBUG : null
}
