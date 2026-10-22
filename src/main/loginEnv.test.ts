import { expect, it } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { loginEnv, resetLoginEnv } from './loginEnv'

it('resolve PATH do shell de login com o claude dentro', async () => {
  resetLoginEnv()
  const env = await loginEnv()
  expect(env.PATH.split(':').length).toBeGreaterThan(1)
  expect(env.claude).toMatch(/\/claude$/)
})

it('falha não fica em cache: a próxima chamada tenta de novo', async () => {
  resetLoginEnv()
  let n = 0
  const exec = async (): Promise<string> => {
    if (n++ === 0) throw new Error('timeout')
    return 'MOTD lixo\n__DK_PATH=/usr/bin\n__DK_CLAUDE=/x/claude\n'
  }
  await expect(loginEnv(exec)).rejects.toThrow('timeout')
  await expect(loginEnv(exec)).resolves.toEqual({ PATH: '/usr/bin', claude: '/x/claude' })
})

it('claude ausente dá mensagem legível', async () => {
  resetLoginEnv()
  await expect(loginEnv(async () => '__DK_PATH=/usr/bin\n__DK_CLAUDE=\n')).rejects.toThrow(
    'claude não encontrado'
  )
})

it('PATH real acha o asdf (brew só entra no shell interativo); sem ele os shims de node/npm quebram', async () => {
  resetLoginEnv()
  const { PATH } = await loginEnv()
  expect(PATH.split(':').some((d) => existsSync(join(d, 'asdf')))).toBe(true)
})
