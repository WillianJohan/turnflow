// Registro único dos canais IPC. A chave é o nome do método em window.turnflow.
import * as clip from './clip'
import * as config from './config'
import * as fonts from './fonts'
import * as header from './header'
import * as pty from './pty'
import * as search from './search'
import * as session from './session'
import * as settings from './settings'
import * as tasks from './tasks'
import * as theme from './theme'
import * as vault from './vault'
import * as win from './win'

export const CHANNELS = {
  listTasks: tasks.tasksList,
  tasksRoot: tasks.tasksRoot,
  plan: tasks.taskPlan,
  readme: tasks.taskReadme,
  sessionInfo: session.taskSessions,
  start: pty.ptyStart,
  startUpdate: pty.ptyStartUpdate,
  startScratch: pty.ptyStartScratch,
  write: pty.ptyWrite,
  send: pty.ptySend,
  resize: pty.ptyResize,
  kill: pty.ptyKill,
  focusWindow: win.winFocus,
  settingsPath: settings.settingsPath,
  headerCached: header.headerCached,
  header: header.headerGet,
  config: config.configGet,
  setConfig: config.configSet,
  cloneTheme: config.configCloneTheme,
  openConfigDir: config.configOpenDir,
  readTheme: theme.themeRead,
  saveTheme: theme.themeSave,
  deleteTheme: theme.themeDelete,
  fonts: fonts.fontsList,
  readClipboard: clip.clipRead,
  writeClipboard: clip.clipWrite,
  bootGet: vault.bootGet,
  firstRunBegin: vault.firstRunBegin,
  firstRunSaveWords: vault.firstRunSaveWords,
  firstRunCommit: vault.firstRunCommit,
  firstRunPickBackup: vault.firstRunPickBackup,
  firstRunRestore: vault.firstRunRestore,
  vaultUnlock: vault.vaultUnlock,
  vaultRecover: vault.vaultRecover,
  searchQuery: search.searchQuery
} as const
export type Channels = typeof CHANNELS
