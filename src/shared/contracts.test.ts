import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// O renderer vai carregar contracts.ts (E6): nada no grafo de imports dele pode puxar módulo Node.
const importsOf = (file: string): string[] =>
  [
    ...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)
  ].map((m) => m[1])

function graph(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>()
  const visit = (file: string): void => {
    if (seen.has(file)) return
    const deps = importsOf(file)
    seen.set(file, deps)
    for (const dep of deps) if (dep.startsWith('.')) visit(resolve(dirname(file), dep) + '.ts')
  }
  visit(entry)
  return seen
}

describe('contracts.ts', () => {
  it('não importa paths.ts nem nenhum módulo Node, direta ou transitivamente', () => {
    const g = graph(resolve(__dirname, 'contracts.ts'))
    expect([...g.keys()].some((f) => f.endsWith('/shared/paths.ts'))).toBe(false)
    const external = [...g.values()].flat().filter((d) => !d.startsWith('.'))
    expect(external.filter((d) => d !== 'zod')).toEqual([])
  })
})
