import { expect, it } from 'vitest'
import { loginEnv, resetLoginEnv } from './loginEnv'

it('falha não fica em cache: a próxima chamada tenta de novo', async () => {
  resetLoginEnv()
  let n = 0
  const exec = async (): Promise<string> => {
    if (n++ === 0) throw new Error('timeout')
    return 'MOTD lixo\n__TURNFLOW_PATH=/usr/bin\n__TURNFLOW_CLAUDE=/x/claude\n'
  }
  await expect(loginEnv(exec)).rejects.toThrow('timeout')
  await expect(loginEnv(exec)).resolves.toEqual({ PATH: '/usr/bin', claude: '/x/claude' })
})

it('claude ausente dá mensagem legível', async () => {
  resetLoginEnv()
  await expect(
    loginEnv(async () => '__TURNFLOW_PATH=/usr/bin\n__TURNFLOW_CLAUDE=\n')
  ).rejects.toThrow('claude não encontrado')
})
