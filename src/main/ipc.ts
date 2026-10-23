import { BrowserWindow, clipboard, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { execFile } from 'child_process'
import { appendFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type { DomainDeps } from '../core/domain/context'
import type { ConfigState, Task } from '../shared/types'
import {
  cloneTheme,
  ensureDefaults,
  parseFcList,
  saveTheme,
  deleteTheme,
  BUILTIN_THEMES,
  listThemes,
  readConfig,
  readTheme,
  readThemesRaw,
  watchConfig,
  writeConfig
} from './appConfig'
import { legacyConfigDir } from '../shared/paths'
import { access, readFile } from 'fs/promises'
import type { Events } from '../shared/ipc/events'
import type { Channel } from '../shared/ipc/define'
import * as C from '../shared/ipc/registry'
import { configDir, runDir, socketPath } from './config'
import { brainTasksDir, createLegacyBrain, sessionCwd } from './brainDir'
import { startHookServer, writeHookSettings } from './hooks'
import { splitCommand, type AgentCommands } from './launch'
import { loginEnv } from './loginEnv'
import { nodePtySpawner, type PtySpawner } from './pty'
import { createPtyGuard } from './ptyGuard'
import { binMatch, findProcessByArg } from './procs'
import { findSessionFile } from './sessions'
import { readUi, writeUi } from './uiStore'
import { createSessionHost, type SessionHost } from './sessionHost'
import { loadTasks, watchTasks } from './tasks'
import { getHeader, readCache } from './header'
import { handle as handleOn, IpcError, type Handler, type IpcLike } from './ipc/handle'
import { registerPtyIo } from './ipc/ptyIo'
import { domainCache, registerDomainIpc } from './ipc/domain'
import { registerSessionIpc } from './ipc/session'
import { registerImportIpc } from './ipc/import'
import { registerSearchIpc } from './ipc/search'
import { registerVaultIpc, type VaultDialogs } from './ipc/vault'
import type { Vault } from '../core/key/vault'
import { changeBus } from './changeBusInstance'

const exec = promisify(execFile)

export type IpcDeps = {
  vault: Vault
  version: string
  /** `folder`: diálogo nativo de pasta (import do brain); `null` = cancelado. */
  dialogs: VaultDialogs & { folder(): Promise<string | null> }
  /** Log local (o mesmo do vault): recebe a mensagem crua dos erros `INTERNAL`. */
  log?: (line: string) => void
  /** Relógio do domínio (fixo pelo `TURNFLOW_TEST_NOW` no build de teste). */
  domain: { now: () => Date }
}

export type RegisteredIpc = {
  dispose(): void
  host: SessionHost
  hooks: { port: number; close(): Promise<void> }
  domain(): DomainDeps | null
}

export async function registerIpc(
  win: BrowserWindow,
  ipc: IpcLike,
  deps: IpcDeps
): Promise<RegisteredIpc> {
  // guard primeiro: o exit dos ptys usa ele, e pode rodar antes do fim do registro
  const guard = createPtyGuard()
  const owner = win.webContents.id
  const send = <K extends keyof Events>(ch: K, ...a: Events[K]): void => {
    if (!win.isDestroyed()) win.webContents.send(ch, ...a)
  }
  const handle = <Ch extends Channel>(ch: Ch, fn: Handler<Ch>): void =>
    handleOn(ipc, ch, fn, { validateOutput: is.dev, log: deps.log })
  let tasks = new Map<string, Task>()

  // lateral herdada (Decisão 25): lista `TURNFLOW_BRAIN ?? config.brainDir` e rearma o watcher a
  // cada troca de pasta (start, leitura de config, apply do import); falha ao ler só vai pro log
  const legacyBrain = createLegacyBrain({
    watch: watchTasks,
    load: loadTasks,
    onChanged: (list) => {
      tasks = new Map(list.map((t) => [t.id, t]))
      send('tasks:changed', list)
    },
    log: deps.log
  })

  const task = (id: string): Task => {
    const t = tasks.get(id)
    if (!t) throw new IpcError('NOT_FOUND', `task ${id} não encontrada`)
    return t
  }

  handle(C.CHANNELS.readClipboard, async () => ({
    text: await clipboard.readText(),
    image: await clipboard.has('image/png')
  }))
  handle(C.CHANNELS.writeClipboard, ({ text }) => clipboard.writeText(text))
  // config.json + themes/ em ~/.config/turnflow; editar à mão aplica na hora
  const cfgDir = configDir()
  await ensureDefaults(cfgDir)
  // última pasta padrão lida do config.json: toda leitura (inclusive a do watch) atualiza
  const startConfig = (await readConfig(cfgDir)).config
  let defaultWorkdir = startConfig.defaultWorkdir
  let agents = startConfig.agents
  await legacyBrain.setDir(brainTasksDir(process.env, startConfig.brainDir))
  const configState = async (): Promise<ConfigState> => {
    const { config, error } = await readConfig(cfgDir)
    // JSON inválido devolve os padrões: a pasta padrão e o brain em uso ficam os anteriores
    if (!error) {
      defaultWorkdir = config.defaultWorkdir
      agents = config.agents
      await legacyBrain.setDir(brainTasksDir(process.env, config.brainDir))
    }
    const t = await readTheme(cfgDir, config.theme)
    return {
      dir: cfgDir,
      config,
      theme: t.theme,
      themes: (await listThemes(cfgDir)).map((t) => ({ ...t, builtin: t.id in BUILTIN_THEMES })),
      error: error ?? t.error
    }
  }
  const unwatchCfg = watchConfig(cfgDir, () =>
    configState().then(
      (s) => send('config:changed', s),
      () => undefined
    )
  )
  handle(C.CHANNELS.uiGet, () => readUi(cfgDir))
  handle(C.CHANNELS.uiSet, async (file) => {
    await writeUi(cfgDir, file)
    return file
  })
  handle(C.CHANNELS.config, () => configState())
  handle(C.CHANNELS.setConfig, async (patch) => {
    await writeConfig(cfgDir, patch)
    return configState()
  })
  handle(C.CHANNELS.cloneTheme, async ({ from }) => {
    const id = await cloneTheme(cfgDir, from)
    await writeConfig(cfgDir, { theme: id })
    shell.openPath(join(cfgDir, 'themes', `${id}.json`))
    return configState()
  })
  handle(C.CHANNELS.openConfigDir, () => void shell.openPath(cfgDir))
  handle(C.CHANNELS.readTheme, async ({ id }) => (await readTheme(cfgDir, id)).theme)
  handle(C.CHANNELS.saveTheme, async ({ id, theme }) => {
    await saveTheme(cfgDir, id, theme)
    await writeConfig(cfgDir, { theme: id })
    return configState()
  })
  handle(C.CHANNELS.deleteTheme, async ({ id }) => {
    await deleteTheme(cfgDir, id)
    const { config } = await readConfig(cfgDir)
    if (config.theme === id) await writeConfig(cfgDir, { theme: 'escuro' })
    return configState()
  })
  // fontes instaladas (fontconfig); mono separado pro terminal
  const fc = (pattern: string): Promise<string[]> =>
    new Promise((res) =>
      execFile('fc-list', [pattern, 'family'], (err, out) => res(err ? [] : parseFcList(out)))
    )
  handle(C.CHANNELS.fonts, async () => ({
    all: await fc(':'),
    mono: await fc(':spacing=mono')
  }))

  handle(C.CHANNELS.listTasks, async () => {
    await legacyBrain.refresh()
    return legacyBrain.list()
  })
  handle(C.CHANNELS.tasksRoot, () => legacyBrain.root())
  // clique na notificação: traz a janela pra frente
  handle(C.CHANNELS.focusWindow, () => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  handle(C.CHANNELS.readme, ({ id }) => readFile(task(id).readmePath, 'utf8').catch(() => ''))

  const domainFor = domainCache({
    now: deps.domain.now,
    defaultWorkdir: () => defaultWorkdir,
    afterCommit: changeBus.afterCommit
  })
  const domain = (): DomainDeps | null => {
    try {
      if (deps.vault.state() !== 'ready') return null
      return domainFor(deps.vault.db())
    } catch {
      return null
    }
  }
  const login = async (): Promise<{ PATH: string; claude: string }> => {
    try {
      return await loginEnv()
    } catch (e) {
      // CI e o build de teste não têm o binário; o testSpawner troca o comando de qualquer jeito
      if (__TURNFLOW_TEST__ && process.env.TURNFLOW_TEST_PTY)
        return { PATH: process.env.PATH ?? '', claude: 'claude' }
      throw e
    }
  }
  const bins = async (): Promise<AgentCommands> => {
    const { config, error } = await readConfig(cfgDir)
    if (!error) agents = config.agents
    const shell = await login()
    return {
      claude: shell.claude,
      codex: splitCommand(agents.codex),
      cursor: splitCommand(agents.cursor),
      other: agents.other === null ? null : splitCommand(agents.other)
    }
  }
  const agentBins = (): string[] =>
    [agents.codex, agents.cursor, agents.other].flatMap((cmd) =>
      cmd ? splitCommand(cmd).slice(0, 1) : []
    )
  let spawner: PtySpawner = nodePtySpawner
  if (__TURNFLOW_TEST__) {
    const { testSpawner } = await import('./testing/pty')
    spawner = testSpawner(process.env, nodePtySpawner, agentBins)
  }
  const portBox = { n: 0 }
  const settingsFile = await writeHookSettings(runDir())
  const host = createSessionHost({
    spawner,
    domain,
    bins,
    path: async () =>
      process.platform === 'win32' ? (process.env.PATH ?? '') : (await login()).PATH,
    settingsPath: settingsFile,
    socketPath: socketPath(),
    hookPort: () => portBox.n,
    defaultWorkdir: () => defaultWorkdir,
    home: homedir(),
    platform: process.platform,
    dirExists: (p) =>
      access(p).then(
        () => true,
        () => false
      ),
    findTranscript: async (uuid) => {
      const found = await findSessionFile(uuid)
      return found ? { cwd: found.cwd } : null
    },
    runningElsewhere: (uuid, own, tool) =>
      findProcessByArg(uuid, {
        ownPids: own,
        platform: process.platform,
        match: binMatch(tool),
        exec: async (file, args) => (await exec(file, args, { timeout: 8000 })).stdout
      }),
    events: {
      data: (id, d) => {
        if (process.env.TURNFLOW_DEBUG) appendFileSync(process.env.TURNFLOW_DEBUG, d)
        send('pty:data', id, d)
      },
      exit: (id, code) => {
        guard.release(id)
        send('pty:exit', id, code)
      },
      state: (id, s, info) => send('pty:state', id, s, info)
    },
    log: (line) => (deps.log ? deps.log(line) : console.error(line))
  })
  const hooks = await startHookServer({
    accept: (token) => host.accept(token),
    onHook: (token, body) => host.onHook(token, body)
  })
  portBox.n = hooks.port
  // renderer recarregou (F5/dev): os xterms morreram junto; não espera aqui
  win.webContents.on('did-start-loading', () => void host.killAllAndWait(0))
  registerPtyIo(ipc, { guard, pty: host, onKill: () => undefined })
  registerSessionIpc(handle, {
    host,
    vault: deps.vault,
    domainFor,
    pickFolder: () => deps.dialogs.folder(),
    guard,
    owner
  })

  handle(C.CHANNELS.headerCached, ({ id }) => readCache(task(id)))
  handle(C.CHANNELS.header, ({ id, force }) =>
    getHeader(task(id), force, { cwd: sessionCwd(defaultWorkdir) })
  )
  registerVaultIpc(handle, deps)
  registerSearchIpc(handle, deps)
  // um DomainDeps por banco, o mesmo para o domínio e o import (Decisão 33)
  registerDomainIpc(handle, { vault: deps.vault, domainFor })
  registerImportIpc(handle, {
    vault: deps.vault,
    domainFor,
    configDir: cfgDir,
    pickFolder: () => deps.dialogs.folder(),
    // o watch do config.json também rearma, mas aqui a lateral já lista quando o apply responde
    setBrainDir: async (dir) => {
      await writeConfig(cfgDir, { brainDir: dir })
      await legacyBrain.setDir(brainTasksDir(process.env, dir))
    },
    legacyDir: () => legacyConfigDir(),
    writeConfig: async (patch) => void (await writeConfig(cfgDir, patch)),
    readThemesRaw: () => readThemesRaw(cfgDir),
    log: deps.log
  })

  return {
    dispose: () => {
      unwatchCfg()
      legacyBrain.close()
      void hooks.close()
    },
    host,
    hooks,
    domain
  }
}
