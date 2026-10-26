import { join } from 'node:path'
import { BRAND } from '../../shared/brand'

export type VaultPaths = {
  dir: string
  keyFile: string
  keyTmp: string
  db: string
  dbInit: string
  backups: string
  attachments: string
  restoreTmp: string
  wipeMarker: string
  logs: string
}

/** Arquivos do vault dentro do diretório de configuração. */
export function vaultPaths(configDir: string): VaultPaths {
  return {
    dir: configDir,
    keyFile: join(configDir, 'key.enc'),
    keyTmp: join(configDir, 'key.enc.tmp'),
    db: join(configDir, BRAND.db),
    dbInit: join(configDir, `${BRAND.db}.init`),
    backups: join(configDir, 'backups'),
    attachments: join(configDir, 'attachments'),
    restoreTmp: join(configDir, 'restore.tmp'),
    wipeMarker: join(configDir, 'wipe.pending'),
    logs: join(configDir, 'logs')
  }
}
