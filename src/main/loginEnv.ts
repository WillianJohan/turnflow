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

let cached: Promise<{ PATH: string; claude: string }> | null = null

const marker = (out: string, k: string): string =>
  out.match(new RegExp(`^${MARK}${k}=(.*)$`, 'm'))?.[1]?.trim() ?? ''

export function loginEnv(exec: Exec = shell): Promise<{ PATH: string; claude: string }> {
  cached ??= exec()
    .then((out) => {
      const PATH = marker(out, 'PATH')
      const claude = marker(out, 'CLAUDE')
      if (!claude) throw new IpcError('NOT_FOUND', CONFIG_COPY.claudeNotFound)
      return { PATH, claude }
    })
    .catch((e) => {
      cached = null // falha não fica em cache: o próximo lançamento tenta de novo
      throw e
    })
  return cached
}

export const resetLoginEnv = (): void => {
  cached = null
}
