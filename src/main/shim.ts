import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BRAND } from '../shared/brand'

// Shim de path estável: as IAs apontam pra ele, e o app o reescreve a cada start com o executável
// atual (o path do AppImage muda a cada versão).
export type ShimTarget =
  | { kind: 'appimage'; appimage: string }
  | { kind: 'exec'; exec: string }
  | { kind: 'dev'; electron: string; appDir: string }

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
    return { file: `${name}.cmd`, body: `@${cmd.map(cmdQuote).join(' ')} %*\r\n`, mode: 0o755 }
  return {
    file: name,
    body: `#!/bin/sh\nexec ${cmd.map(shQuote).join(' ')} "$@"\n`,
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
