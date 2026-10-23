import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

/** Log local em arquivo, com rotação simples: ao passar de maxBytes o atual vira `<file>.1`. */
export function createLocalLog(file: string, maxBytes = 1_048_576): (line: string) => void {
  return (line) => {
    try {
      write(line)
    } catch {
      // log nunca derruba quem o chama
    }
  }

  function write(line: string): void {
    const entry = `${new Date().toISOString()} ${line}\n`
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    let size = 0
    try {
      size = statSync(file).size
    } catch {
      // arquivo ainda não existe
    }
    if (size > 0 && size + Buffer.byteLength(entry) > maxBytes) renameSync(file, `${file}.1`)
    appendFileSync(file, entry, { mode: 0o600 })
  }
}
