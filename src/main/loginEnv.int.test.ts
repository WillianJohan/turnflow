import { expect, it } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { loginEnv, resetLoginEnv } from './loginEnv'

// Dependem das ferramentas da máquina de quem desenvolve (claude, asdf): ligue com TURNFLOW_LOCAL=1.
const local = !!process.env.TURNFLOW_LOCAL

it.skipIf(!local)('resolve PATH do shell de login com o claude dentro', async () => {
  resetLoginEnv()
  const env = await loginEnv()
  expect(env.PATH.split(':').length).toBeGreaterThan(1)
  expect(env.claude).toMatch(/\/claude$/)
})

it.skipIf(!local)(
  'PATH real acha o asdf (brew só entra no shell interativo); sem ele os shims de node/npm quebram',
  async () => {
    resetLoginEnv()
    const { PATH } = await loginEnv()
    expect(PATH.split(':').some((d) => existsSync(join(d, 'asdf')))).toBe(true)
  }
)
