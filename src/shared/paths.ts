import { posix, win32 } from 'path'
import { createHash } from 'crypto'
import { homedir, userInfo } from 'os'
import { BRAND } from './brand'

// Funções puras (sem electron): o CLI e o app resolvem os mesmos caminhos.
const ENV = BRAND.envPrefix

const pathFor = (platform: NodeJS.Platform): typeof posix => (platform === 'win32' ? win32 : posix)

const appDirName = (platform: NodeJS.Platform, dev: boolean): string => {
  const base = platform === 'darwin' || platform === 'win32' ? BRAND.name : BRAND.id
  return dev ? `${base}-dev` : base
}

export function configDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  dev = false
): string {
  const override = env[`${ENV}CONFIG_DIR`]
  if (override) return override
  const p = pathFor(platform)
  const name = appDirName(platform, dev)
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', name)
  if (platform === 'win32') return p.join(env.APPDATA ?? p.join(home, 'AppData', 'Roaming'), name)
  return p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), name)
}

export function binDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  dev = false
): string {
  return pathFor(platform).join(configDir(env, platform, home, dev), 'bin')
}

export function runDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  dev = false
): string {
  const p = pathFor(platform)
  if (platform === 'linux' && env.XDG_RUNTIME_DIR) {
    // TURNFLOW_CONFIG_DIR (testes/instância isolada) ganha socket próprio: hash curto do config dir
    // mantém o sun_path pequeno e não colide com o app de verdade
    const override = env[`${ENV}CONFIG_DIR`]
    if (override) {
      const hash = createHash('sha256').update(override).digest('hex').slice(0, 8)
      return p.join(env.XDG_RUNTIME_DIR, `${BRAND.id}-${hash}${dev ? '-dev' : ''}`)
    }
    return p.join(env.XDG_RUNTIME_DIR, appDirName(platform, dev))
  }
  return p.join(configDir(env, platform, home, dev), 'run')
}

export function socketPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  dev = false,
  // identidade do usuário (injetável p/ manter a função pura); entra só como hash no nome do pipe
  identity: string = `${userInfo().username}@${env.USERDOMAIN ?? ''}`
): string {
  const override = env[`${ENV}SOCKET`]
  if (override) return override
  if (platform === 'win32') {
    const hash = createHash('sha256').update(identity).digest('hex').slice(0, 8)
    return `\\\\.\\pipe\\${BRAND.id}${dev ? '-dev' : ''}-${hash}`
  }
  return pathFor(platform).join(runDir(env, platform, home, dev), `${BRAND.id}.sock`)
}
