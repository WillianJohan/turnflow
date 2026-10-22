import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BRAND } from '../shared/brand'

// Shim de path estável: as IAs apontam pra ele, e o app o reescreve a cada start com o executável
// atual (o path do AppImage muda a cada versão).
export type ShimTarget =
  | { kind: 'appimage'; appimage: string }
  | { kind: 'exec'; exec: string }
  | { kind: 'dev'; electron: string; appDir: string }

// dev primeiro (electron . aberto de dentro de um AppImage herda APPIMAGE); AppImage só quando o
// próprio executável mora no APPDIR montado — senão o APPIMAGE é herança de outro processo
export function detectShimTarget(d: {
  dev: boolean
  execPath: string
  appPath: string
  env: NodeJS.ProcessEnv
}): ShimTarget {
  if (d.dev) return { kind: 'dev', electron: d.execPath, appDir: d.appPath }
  const { APPIMAGE, APPDIR } = d.env
  if (APPIMAGE && APPDIR && d.execPath.startsWith(APPDIR.replace(/\/+$/, '') + '/'))
    return { kind: 'appimage', appimage: APPIMAGE }
  return { kind: 'exec', exec: d.execPath }
}

export interface ShimContent {
  file: string
  body: string
  mode: number
}

// dentro de aspas duplas do sh só \ " $ ` são especiais
const shQuote = (s: string): string => `"${s.replace(/[\\"$`]/g, (c) => '\\' + c)}"`
// no .cmd o % expande variável mesmo entre aspas; " não existe em path do Windows
const cmdQuote = (s: string): string => `"${s.replace(/%/g, '%%')}"`

const command = (t: ShimTarget): string[] =>
  t.kind === 'appimage' ? [t.appimage] : t.kind === 'exec' ? [t.exec] : [t.electron, t.appDir]

export function shimContent(target: ShimTarget, platform: NodeJS.Platform): ShimContent {
  const name = target.kind === 'dev' ? `${BRAND.id}-dev` : BRAND.id
  const cmd = command(target)
  if (platform === 'win32')
    return {
      file: `${name}.cmd`,
      body: `@set ELECTRON_RUN_AS_NODE=\r\n@${cmd.map(cmdQuote).join(' ')} %*\r\n`,
      mode: 0o755
    }
  return {
    file: name,
    // ELECTRON_RUN_AS_NODE herdado faria o Electron rodar como node puro e ignorar o app
    body: `#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexec ${cmd.map(shQuote).join(' ')} "$@"\n`,
    mode: 0o755
  }
}

export function writeShim(binDir: string, content: ShimContent): void {
  mkdirSync(binDir, { recursive: true })
  const dest = join(binDir, content.file)
  // escreve ao lado e renomeia: uma IA subindo o shim nunca lê arquivo pela metade
  const tmp = `${dest}.${process.pid}.tmp`
  writeFileSync(tmp, content.body, { mode: content.mode })
  chmodSync(tmp, content.mode)
  renameSync(tmp, dest)
}
