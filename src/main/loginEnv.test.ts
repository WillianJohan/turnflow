import { expect, it } from 'vitest'
import { loginEnv, resetLoginEnv, shellEnv } from './loginEnv'

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

it('win32 usa where.exe e prefere o .exe ao .cmd e ao script sem extensão', async () => {
  resetLoginEnv()
  // saída real do where.exe com o claude do npm: o script sh sem extensão vem primeiro
  const out =
    'C:\\Users\\me\\AppData\\Roaming\\npm\\claude\r\n' +
    'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd\r\n' +
    'C:\\Users\\me\\.local\\bin\\claude.exe\r\n'
  const env = await loginEnv(async () => out, 'win32')
  expect(env.claude).toBe('C:\\Users\\me\\.local\\bin\\claude.exe')
  expect(env.PATH).toBe(process.env.PATH ?? '')
  resetLoginEnv()
  const npm = await loginEnv(
    async () =>
      'C:\\Users\\me\\AppData\\Roaming\\npm\\claude\r\nC:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd\r\n',
    'win32'
  )
  expect(npm.claude).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd')
  resetLoginEnv()
  await expect(
    loginEnv(async () => 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude\r\n', 'win32')
  ).rejects.toThrow('claude não encontrado')
})

it('win32 sem claude no where.exe dá mensagem legível', async () => {
  resetLoginEnv()
  await expect(loginEnv(async () => '\r\n', 'win32')).rejects.toThrow('claude não encontrado')
})

it('shellEnv devolve o PATH mesmo sem claude (terminal, Codex e Cursor não precisam dele)', async () => {
  resetLoginEnv()
  await expect(
    shellEnv(async () => '__TURNFLOW_PATH=/usr/bin:/opt/bin\n__TURNFLOW_CLAUDE=\n')
  ).resolves.toEqual({ PATH: '/usr/bin:/opt/bin', claude: null })
  resetLoginEnv()
  await expect(shellEnv(async () => '\r\n', 'win32')).resolves.toMatchObject({ claude: null })
})
