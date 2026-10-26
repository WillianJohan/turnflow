import { app, dialog, ipcMain, session, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { is } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { runShutdown, shutdownPlan } from './shutdown'
import type { DomainDeps } from '../core/domain/context'
import type { SessionHost } from './sessionHost'
import { windowPrefs } from './windowPrefs'
import { isExternalLink } from './links'
import { binDir, configDir, socketPath } from './config'
import { BRAND } from '../shared/brand'
import { DEFAULT_THEME } from '../shared/theme/builtins'
import { VAULT_COPY } from '../shared/copy/vault'
import { changeBus } from './changeBusInstance'
import { cliUserDataDir } from '../shared/paths'
import { parseCli, runCli } from '../cli/dispatch'
import { detectShimTarget, shimContent, writeShim } from './shim'
import { startSocketServer, stubMcpHandler } from './socketServer'
import { createQueryTimer, instrumentDb, type QueryTimer } from '../core/db/timing'
import { vaultPaths } from '../core/key/paths'
import { createVault, type Vault } from '../core/key/vault'
import { selectKeyBackend } from './keychain'
import { createLocalLog } from './localLog'
import { writeSecretFile } from './secretFile'
import { installDevMenu } from './devMenu'
import { wireVaultEvents, type VaultDialogs } from './ipc/vault'

// Despacho do modo CLI (`turnflow mcp`): antes do lock, do whenReady e de qualquer janela.
// O lock é da instância com janela; a CLI nunca o disputa nem foca a janela aberta.
const cli = parseCli(process.argv)
if (cli.mode === 'cli') {
  // antes de qualquer outra coisa do Electron: sem isso o Chromium cria ~/.config/<BRAND.name>/
  // (Local State, Crashpad) a cada execução, ignorando TURNFLOW_CONFIG_DIR e o sufixo -dev
  const cliData = cliUserDataDir(process.env, process.platform, homedir(), !app.isPackaged)
  mkdirSync(cliData, { recursive: true, mode: 0o700 })
  app.setPath('userData', cliData)
  app.setPath('sessionData', cliData)
  app.setPath('crashDumps', join(cliData, 'crashes'))
  app.dock?.hide()
  // nada de diálogo de erro do Electron nem processo pendurado: CLI sai com código
  process.on('uncaughtException', (e) => {
    try {
      process.stderr.write(`${e.message}\n`)
    } catch {
      // stderr também pode estar morto
    }
    app.exit(1)
  })
  runCli(cli, {
    socket: socketPath(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr
  }).then(
    (code) => app.exit(code),
    (e) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
      app.exit(1)
    }
  )
} else startApp()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: DEFAULT_THEME.ui.bg,
    title: BRAND.name,
    icon: join(__dirname, `../../resources/${BRAND.id}.png`),
    webPreferences: windowPrefs(join(__dirname, '../preload/index.js'))
  })
  win.on('ready-to-show', () => win.show())
  // arquivo solto na janela ou link não pode trocar a página: o reload mataria todos os PTYs
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.TURNFLOW_DEBUG)
    win.webContents.on('console-message', (e) => console.log('[r]', e.message))
  win.webContents.setWindowOpenHandler((d) => {
    if (isExternalLink(d.url)) shell.openExternal(d.url)
    return { action: 'deny' }
  })
  // dev: TURNFLOW_SHOT=<png> tira um print após N ms (TURNFLOW_SHOT_MS) e fecha
  const shot = process.env.TURNFLOW_SHOT
  // TURNFLOW_SHOT_JS: JS rodado no renderer 2s após carregar (simular teclas nos prints)
  const js = process.env.TURNFLOW_SHOT_JS
  if (shot && js)
    win.webContents.once('did-finish-load', () =>
      setTimeout(() => win.webContents.executeJavaScript(js), 2000)
    )
  if (shot)
    setTimeout(
      async () => {
        writeFileSync(shot, (await win.webContents.capturePage()).toPNG())
        app.quit()
      },
      Number(process.env.TURNFLOW_SHOT_MS ?? 4000)
    )
  return win
}

// shim de path estável + socket local: falha aqui não derruba a janela
async function startLocalSurface(): Promise<{ close(): Promise<void> } | null> {
  try {
    const target = detectShimTarget({
      dev: is.dev,
      execPath: process.execPath,
      appPath: app.getAppPath(),
      env: process.env
    })
    writeShim(binDir(), shimContent(target, process.platform))
  } catch (e) {
    console.error('[shim]', e)
  }
  try {
    return await startSocketServer(socketPath(), stubMcpHandler, {
      secureDir: !process.env[`${BRAND.envPrefix}SOCKET`]
    })
  } catch (e) {
    // ALREADY_RUNNING com o lock na mão = outra instância com outro userData (ex.: teste)
    console.error('[socket]', e instanceof Error ? e.message : e)
    return null
  }
}

// Diálogo de salvar nativo; o arquivo (chave de recuperação) fica só para o dono.
function vaultDialogs(win: BrowserWindow): VaultDialogs {
  return {
    async save(defaultName, text) {
      const r = await dialog.showSaveDialog(win, {
        defaultPath: join(app.getPath('documents'), defaultName)
      })
      if (r.canceled || !r.filePath) return null
      await writeSecretFile(r.filePath, text)
      return r.filePath
    },
    async open() {
      const r = await dialog.showOpenDialog(win, {
        defaultPath: vaultPaths(configDir()).backups,
        properties: ['openFile'],
        filters: [{ name: VAULT_COPY.backupFilter, extensions: ['db'] }]
      })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    }
  }
}

// Diálogo nativo de pasta (import do brain); cancelado = null.
async function pickFolder(win: BrowserWindow): Promise<string | null> {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return r.canceled ? null : (r.filePaths[0] ?? null)
}

// rascunhos do Composer e layout ficam no localStorage, em texto plano (configDir/electron/)
async function clearBrowserData(): Promise<void> {
  await session.defaultSession.clearStorageData()
  await session.defaultSession.clearCache()
}

type VaultLog = (level: 'warn' | 'error', line: string) => void

/**
 * Cofre do banco. O timer entra pelo `instrument` do `openDb`, que o instala depois do
 * `PRAGMA key` (o `db.pragma()` nem passa pelo `prepare` instrumentado). O backup diário
 * (na entrada em `ready` e o agendado) é do próprio vault.
 */
async function startVault(
  vaultListeners: ((ready: boolean) => void)[]
): Promise<{ vault: Vault; timer: QueryTimer; log: VaultLog }> {
  const backend = await selectKeyBackend()
  const paths = vaultPaths(configDir())
  let log: VaultLog
  if (is.dev) log = (level, line) => console[level](line)
  else {
    const fileLog = createLocalLog(join(paths.logs, `${BRAND.id}.log`))
    log = (level, line) => fileLog(`${level} ${line}`)
  }
  const timer = createQueryTimer({ mode: is.dev ? 'dev' : 'prod', log })
  const broadcast = wireVaultEvents({
    vault: () => vault,
    version: app.getVersion(),
    broadcast: (b) =>
      BrowserWindow.getAllWindows().forEach(
        (w) => !w.isDestroyed() && w.webContents.send('vault.changed', b)
      )
  })
  const onChange = (): void => {
    broadcast()
    const ready = vault.state() === 'ready'
    for (const listener of vaultListeners) listener(ready)
  }
  const vault = createVault({
    paths,
    backend,
    instrument: (db) => instrumentDb(db, timer),
    onChange,
    log,
    // dentro do wipe, antes de o marcador sair: falha vira failed e o retry/próximo boot refazem
    clearExternal: clearBrowserData
  })
  await vault.boot()
  return { vault, timer, log }
}

function startApp(): void {
  // sem menu: os aceleradores padrão (Ctrl+R, Ctrl+Shift+R, Ctrl+W) recarregavam/fechavam a janela.
  // No dev o menu de diagnóstico (installDevMenu) entra no whenReady, também sem esses aceleradores.
  Menu.setApplicationMenu(null)

  // antes do lock: o lock do Electron é por userData
  app.setPath('userData', join(configDir(), 'electron'))

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  let main: BrowserWindow | undefined
  app.on('second-instance', () => {
    if (!main || main.isDestroyed()) return
    if (main.isMinimized()) main.restore()
    main.focus()
  })

  const vaultListeners: ((ready: boolean) => void)[] = []
  const stop: {
    vault: Vault | null
    host: SessionHost | null
    hooks: { close(): Promise<void> } | null
    domain: (() => DomainDeps | null) | null
    socket: { close(): Promise<void> } | null
    log: (line: string) => void
  } = {
    vault: null,
    host: null,
    hooks: null,
    domain: null,
    socket: null,
    log: (line) => console.error(line)
  }
  let quitting = false
  app.on('will-quit', (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    const steps =
      stop.host && stop.hooks && stop.domain && stop.vault
        ? shutdownPlan({
            host: stop.host,
            domain: stop.domain,
            socket: stop.socket,
            hooks: stop.hooks,
            changeBus,
            vault: stop.vault
          })
        : [
            { name: 'changeBus', run: () => changeBus.dispose() },
            { name: 'vault', run: () => stop.vault?.close() }
          ]
    void runShutdown(steps, { totalMs: 5000, log: stop.log }).finally(() => app.exit(0))
  })

  app.whenReady().then(async () => {
    if (__TURNFLOW_TEST__) (await import('./testing')).installTestHooks()
    // relógio do domínio: só o build de teste aceita TURNFLOW_TEST_NOW (o ramo some no release)
    const now = __TURNFLOW_TEST__
      ? ((await import('./testing/clock')).testNow(process.env) ?? (() => new Date()))
      : () => new Date()
    const { vault, timer, log } = await startVault(vaultListeners)
    stop.vault = vault
    stop.log = (line) => log('error', line)
    if (is.dev) installDevMenu(() => timer.stats())
    const win = createWindow()
    main = win
    // handlers registrados antes de carregar a página: senão o renderer chama antes de existirem
    const registered = await registerIpc(win, ipcMain, {
      vault,
      version: app.getVersion(),
      dialogs: { ...vaultDialogs(win), folder: () => pickFolder(win) },
      log: (line) => log('error', line),
      domain: { now }
    })
    stop.host = registered.host
    stop.hooks = registered.hooks
    stop.domain = registered.domain
    let prevReady = vault.state() === 'ready'
    vaultListeners.push((ready) => {
      if (ready === prevReady) return
      prevReady = ready
      if (ready) {
        const d = registered.domain()
        if (d) registered.host.onVaultReady(d)
      } else registered.host.onVaultLeft()
    })
    if (prevReady) {
      const d = registered.domain()
      if (d) registered.host.onVaultReady(d)
    }
    if (is.dev && process.env['ELECTRON_RENDERER_URL'])
      win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    else win.loadFile(join(__dirname, '../renderer/index.html'))
    win.on('closed', () => registered.dispose())
    stop.socket = await startLocalSurface()
  })

  app.on('window-all-closed', () => app.quit())
}
