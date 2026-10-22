import { app, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { windowPrefs } from './windowPrefs'
import { isExternalLink } from './links'
import { configDir } from './config'
import { BRAND } from '../shared/brand'
import { changeBus } from './changeBusInstance'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#14161a',
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

// sem menu: os aceleradores padrão (Ctrl+R, Ctrl+Shift+R, Ctrl+W) recarregavam/fechavam a janela
Menu.setApplicationMenu(null)

app.setPath('userData', join(configDir(), 'electron'))

app.on('will-quit', changeBus.dispose)

app.whenReady().then(async () => {
  if (__TURNFLOW_TEST__) (await import('./testing')).installTestHooks()
  const win = createWindow()
  // handlers registrados antes de carregar a página: senão o renderer chama antes de existirem
  const dispose = await registerIpc(win)
  if (is.dev && process.env['ELECTRON_RENDERER_URL'])
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', dispose)
})

app.on('window-all-closed', () => app.quit())
