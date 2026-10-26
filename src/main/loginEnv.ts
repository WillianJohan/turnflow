import { execFile } from 'child_process'
import { promisify } from 'util'
import { BRAND } from '../shared/brand'
import { CONFIG_COPY } from '../shared/copy/config'
import { IpcError } from './ipc/handle'

type Exec = () => Promise<string>

// Aberto pelo .desktop, o Electron não herda o PATH do shell. O brew (onde mora o asdf) só entra
// no shell interativo, então pergunta a um `bash -ic` com ambiente limpo (igual ao do .desktop).
// Sem TTY: MOTD e consultas de cor saem no stdout e são ignorados pelos marcadores.
const MARK = `__${BRAND.envPrefix.replace(/_$/, '')}_`
const shell: Exec = () =>
  promisify(execFile)(
    'bash',
    ['-ic', `printf "\\n${MARK}PATH=%s\\n${MARK}CLAUDE=%s\\n" "$PATH" "$(command -v claude)"`],
    {
      timeout: 15000,
      env: {
        HOME: process.env.HOME ?? '',
        USER: process.env.USER ?? '',
        LANG: process.env.LANG ?? 'C.UTF-8',
        TERM: 'dumb'
      }
    }
  ).then((r) => r.stdout)

/** PATH do shell de login e o claude dele (`null` quando não está instalado). */
export type ShellEnv = { PATH: string; claude: string | null }

let cached: Promise<ShellEnv> | null = null
let cachedPlatform: NodeJS.Platform | null = null

const marker = (out: string, k: string): string =>
  out.match(new RegExp(`^${MARK}${k}=(.*)$`, 'm'))?.[1]?.trim() ?? ''

// No Windows não há bash -ic. O PATH é o do processo; o claude sai da primeira linha do where.exe.
const whereClaude: Exec = () =>
  promisify(execFile)('where.exe', ['claude'], { timeout: 15000 }).then((r) => r.stdout)

const fromBash = (out: string): ShellEnv => ({
  PATH: marker(out, 'PATH'),
  claude: marker(out, 'CLAUDE') || null
})

const fromWhere = (out: string): ShellEnv => {
  const claude = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0)
  return { PATH: process.env.PATH ?? '', claude: claude ?? null }
}

/**
 * PATH do login sem exigir o claude: o terminal puro, o Codex e o Cursor rodam sem ele.
 * Rejeita só se o shell falhar (timeout); a falha não fica em cache.
 */
export function shellEnv(
  exec?: Exec,
  platform: NodeJS.Platform = process.platform
): Promise<ShellEnv> {
  if (cachedPlatform !== platform) cached = null
  cachedPlatform = platform
  const run = exec ?? (platform === 'win32' ? whereClaude : shell)
  if (!cached) {
    const pending = run()
      .then((out) => (platform === 'win32' ? fromWhere(out) : fromBash(out)))
      .catch((e) => {
        // falha não fica em cache: o próximo lançamento tenta de novo.
        // Só apaga se esta ainda for a promise vigente (outra plataforma pode ter trocado).
        if (cached === pending) cached = null
        throw e
      })
    cached = pending
  }
  return cached
}

/** Como o `shellEnv`, mas o claude é obrigatório: sem ele, `NOT_FOUND` com o texto da copy. */
export async function loginEnv(
  exec?: Exec,
  platform: NodeJS.Platform = process.platform
): Promise<{ PATH: string; claude: string }> {
  const env = await shellEnv(exec, platform)
  if (!env.claude) throw new IpcError('NOT_FOUND', CONFIG_COPY.claudeNotFound)
  return { PATH: env.PATH, claude: env.claude }
}

export const resetLoginEnv = (): void => {
  cached = null
  cachedPlatform = null
}
