import { app } from 'electron'
import { homedir } from 'os'
import {
  binDir as resolveBinDir,
  configDir as resolveConfigDir,
  socketPath as resolveSocketPath
} from '../shared/paths'
import { join } from 'path'

export const CLAUDE_PROJECTS = join(homedir(), '.claude/projects')

// ~/.config/turnflow: só config.json + themes/ (o que o usuário edita).
// Cache, Local Storage, hooks.json e resumos ficam em ~/.config/turnflow/electron (setPath no index.ts).
// TURNFLOW_CONFIG_DIR: pasta isolada pra testes (não mexe no app aberto do usuário)
// A pasta do brain da lateral herdada vem de TURNFLOW_BRAIN ?? config.brainDir (brainDir.ts).
export const configDir = (): string =>
  resolveConfigDir(process.env, process.platform, homedir(), !app.isPackaged)
export const userDataDir = (): string => app.getPath('userData')
// mesmos caminhos que o modo CLI resolve (dev = não empacotado → turnflow-dev)
export const socketPath = (): string =>
  resolveSocketPath(process.env, process.platform, homedir(), !app.isPackaged)
export const binDir = (): string =>
  resolveBinDir(process.env, process.platform, homedir(), !app.isPackaged)
