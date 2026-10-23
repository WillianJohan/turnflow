// Registro único dos canais IPC. A chave é o nome do método em window.turnflow.
import * as clip from './clip'
import * as config from './config'
import * as domain from './domain'
import * as fonts from './fonts'
import * as header from './header'
import * as imp from './import'
import * as pty from './pty'
import * as search from './search'
import * as session from './session'
import * as tasks from './tasks'
import * as theme from './theme'
import * as vault from './vault'
import * as win from './win'

export const CHANNELS = {
  listTasks: tasks.tasksList,
  tasksRoot: tasks.tasksRoot,
  readme: tasks.taskReadme,
  ptySpawn: pty.ptySpawn,
  sessionList: session.sessionList,
  sessionAdopt: session.sessionAdopt,
  sessionPickWorkdir: session.sessionPickWorkdir,
  write: pty.ptyWrite,
  send: pty.ptySend,
  resize: pty.ptyResize,
  kill: pty.ptyKill,
  focusWindow: win.winFocus,
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
  vaultWipe: vault.vaultWipe,
  vaultRetry: vault.vaultRetry,
  searchQuery: search.searchQuery,
  taskList: domain.taskList,
  taskGet: domain.taskGet,
  attentionCounts: domain.attentionCounts,
  flowList: domain.flowList,
  taskTypeList: domain.taskTypeList,
  projectList: domain.projectList,
  projectGet: domain.projectGet,
  activityList: domain.activityList,
  taskCreate: domain.taskCreate,
  taskUpdate: domain.taskUpdate,
  taskSetWorkdir: domain.taskSetWorkdir,
  taskSetStage: domain.taskSetStage,
  taskClose: domain.taskClose,
  taskBlock: domain.taskBlock,
  taskUnblock: domain.taskUnblock,
  taskDismiss: domain.taskDismiss,
  taskDelete: domain.taskDelete,
  taskMove: domain.taskMove,
  taskSetFlow: domain.taskSetFlow,
  checkpointAdd: domain.checkpointAdd,
  projectCreate: domain.projectCreate,
  projectUpdate: domain.projectUpdate,
  projectDelete: domain.projectDelete,
  flowSaveStage: domain.flowSaveStage,
  flowDeleteStage: domain.flowDeleteStage,
  activityUndo: domain.activityUndo,
  importDryRun: imp.importDryRun,
  importApply: imp.importApply,
  importPickFolder: imp.importPickFolder,
  importLegacyDryRun: imp.importLegacyDryRun,
  importLegacyApply: imp.importLegacyApply,
  exportMarkdown: imp.exportMarkdown
} as const
export type Channels = typeof CHANNELS
