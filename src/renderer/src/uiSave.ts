import type { UiFile } from '../../shared/uiFile'

const DELAY = 500

/** Junta várias mudanças e grava uma vez, 500 ms depois da última. */
export function createUiSaver(save: (file: UiFile) => void): {
  push(file: UiFile): void
  flush(): void
  cancel(): void
} {
  let timer: ReturnType<typeof setTimeout> | undefined
  let latest: UiFile | null = null
  const clear = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  return {
    push(file) {
      latest = file
      clear()
      timer = setTimeout(() => {
        timer = undefined
        const next = latest
        latest = null
        if (next) save(next)
      }, DELAY)
    },
    flush() {
      clear()
      const next = latest
      latest = null
      if (next) save(next)
    },
    cancel() {
      clear()
      latest = null
    }
  }
}
