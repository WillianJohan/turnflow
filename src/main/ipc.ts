import { BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { execFile } from 'child_process'
import { appendFileSync } from 'fs'
import { join } from 'path'
import type { AppConfig, ConfigState, Theme } from '../shared/types'
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
  watchConfig,
  writeConfig
} from './appConfig'
import { access, readFile } from 'fs/promises'
import type { How, SessionInfo, Task } from '../shared/types'
import { BRAIN_TASKS, DIGITALK_HOME, configDir, userDataDir } from './config'
import { startHookServer, writeHookSettings } from './hooks'
import { claudeArgv, inUseBy, resolveLaunch } from './launch'
import { loginEnv } from './loginEnv'
import { BRAND } from '../shared/brand'
import {
  alivePtys,
  killAll,
  killPty,
  ownPids,
  renamePty,
  resizePty,
  startPty,
  writePty
} from './pty'
import { adoptions } from './adopt'
import { findSessionFile, runningElsewhere } from './sessions'
import { loadTasks, watchTasks } from './tasks'
import { getHeader, readCache } from './header'

export const UPDATE_ID = '__update__'

export async function registerIpc(win: BrowserWindow): Promise<() => void> {
  const send = (ch: string, ...a: unknown[]): void => {
    if (!win.isDestroyed()) win.webContents.send(ch, ...a)
  }
  let tasks = new Map<string, Task>()
  const reload = async (): Promise<Task[]> => {
    const list = await loadTasks()
    tasks = new Map(list.map((t) => [t.id, t]))
    return list
  }
  await reload()

  // uuid (session_id do claude) de cada PTY vivo, pra recusar a mesma conversa em duas abas
  // e pra descobrir quando uma aba avulsa virou task
  const uuidOf = new Map<string, string>()
  // id antigo → atual: o processo adotado continua mandando hook com o TURNFLOW_TASK de nascença
  const alias = new Map<string, string>()

  // Aba "Claude sem task" cuja conversa o README de uma task passou a citar: vira a aba da task.
  const adopt = (): void => {
    const busy = new Set(alivePtys().filter((id) => !id.startsWith('~')))
    for (const { from, to } of adoptions(uuidOf, [...tasks.values()], busy)) {
      if (!renamePty(from, to)) continue
      alias.set(from, to)
      for (const [k, v] of alias) if (v === from) alias.set(k, to)
      uuidOf.set(to, uuidOf.get(from)!)
      uuidOf.delete(from)
      send('pty:renamed', from, to)
    }
  }
  const unwatch = watchTasks(BRAIN_TASKS, async () => {
    send('tasks:changed', await reload())
    adopt()
  })

  const hooks = await startHookServer((raw, st, sid, info) => {
    const id = alias.get(raw) ?? raw
    if (process.env.TURNFLOW_DEBUG) console.log('[hook]', raw, id, st, sid)
    if (sid && alivePtys().includes(id) && uuidOf.get(id) !== sid) {
      uuidOf.set(id, sid)
      adopt()
    }
    send('pty:state', alias.get(raw) ?? raw, st, info)
  })
  const settingsPath = await writeHookSettings(userDataDir())
  const depsFor = (self: string): Parameters<typeof resolveLaunch>[1] => ({
    find: (u: string) => findSessionFile(u),
    elsewhere: (u: string) => runningElsewhere(u, ownPids()),
    cwdExists: (d: string) =>
      access(d).then(
        () => true,
        () => false
      ),
    inApp: (u: string) => inUseBy(u, uuidOf, self)
  })
  const task = (id: string): Task => {
    const t = tasks.get(id)
    if (!t) throw new Error(`task ${id} não encontrada`)
    return t
  }
  const ptyEvents = {
    data: (id: string, d: string) => send('pty:data', id, d),
    exit: (id: string, code: number) => {
      uuidOf.delete(id)
      for (const [k, v] of alias) if (v === id) alias.delete(k)
      send('pty:exit', id, code)
      send('pty:state', id, 'idle')
    }
  }
  const env = async (id: string): Promise<Record<string, string>> => ({
    PATH: (await loginEnv()).PATH,
    TURNFLOW_PORT: String(hooks.port),
    TURNFLOW_TOKEN: hooks.token,
    TURNFLOW_TASK: id
  })

  // renderer recarregou (F5/dev): os xterms morreram junto, então os PTYs também morrem
  win.webContents.on('did-start-loading', killAll)
  if (process.env.TURNFLOW_DEBUG)
    ptyEvents.data = ((orig) => (id: string, d: string) => {
      appendFileSync(process.env.TURNFLOW_DEBUG!, d)
      orig(id, d)
    })(ptyEvents.data)

  ipcMain.handle('clip:read', async () => ({
    text: await clipboard.readText(),
    image: await clipboard.has('image/png')
  }))
  ipcMain.on('clip:write', (_e, t: string) => clipboard.writeText(t))
  // config.json + themes/ em ~/.config/turnflow; editar à mão aplica na hora
  const cfgDir = configDir()
  await ensureDefaults(cfgDir)
  const configState = async (): Promise<ConfigState> => {
    const { config, error } = await readConfig(cfgDir)
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
  ipcMain.handle('config:get', () => configState())
  ipcMain.handle('config:set', async (_e, patch: Partial<AppConfig>) => {
    await writeConfig(cfgDir, patch)
    return configState()
  })
  ipcMain.handle('config:cloneTheme', async (_e, from: string) => {
    const id = await cloneTheme(cfgDir, from)
    await writeConfig(cfgDir, { theme: id })
    shell.openPath(join(cfgDir, 'themes', `${id}.json`))
    return configState()
  })
  ipcMain.on('config:openDir', () => shell.openPath(cfgDir))
  ipcMain.handle('theme:read', async (_e, id: string) => (await readTheme(cfgDir, id)).theme)
  ipcMain.handle('theme:save', async (_e, id: string, theme: Theme) => {
    await saveTheme(cfgDir, id, theme)
    await writeConfig(cfgDir, { theme: id })
    return configState()
  })
  ipcMain.handle('theme:delete', async (_e, id: string) => {
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
  ipcMain.handle('fonts:list', async () => ({
    all: await fc(':'),
    mono: await fc(':spacing=mono')
  }))

  ipcMain.handle('tasks:list', () => reload())
  ipcMain.handle('task:plan', (_e, id: string, uuid?: string) =>
    resolveLaunch(task(id), depsFor(id), uuid)
  )
  ipcMain.handle('pty:start', async (_e, id: string, how: How, cols: number, rows: number) => {
    if (alivePtys().includes(id)) return // start duplicado (duplo clique): o primeiro já subiu
    const t = task(id)
    let cwd = DIGITALK_HOME
    if ('resume' in how) {
      // revalida logo antes de lançar: a sessão pode ter sido aberta fora nesse meio tempo
      const plan = await resolveLaunch(t, depsFor(id), how.resume)
      if (plan.kind === 'elsewhere')
        throw new Error(
          plan.by
            ? `essa conversa já está aberta na aba ${plan.by}`
            : `sessão aberta fora do ${BRAND.name} (PID ${plan.pid})`
        )
      if (plan.kind === 'gone') throw new Error(`a pasta dessa sessão não existe mais: ${plan.cwd}`)
      if (plan.kind !== 'resume') throw new Error('sessão não existe mais')
      cwd = plan.cwd || DIGITALK_HOME
    }
    const [, ...args] = claudeArgv(t, settingsPath, how)
    const bin = (await loginEnv()).claude
    if (alivePtys().includes(id)) return
    startPty(id, [bin, ...args], cwd, await env(id), cols, rows, ptyEvents)
    if ('resume' in how) uuidOf.set(id, how.resume)
  })
  // comando fixo: o renderer não escolhe o que executar
  ipcMain.handle('pty:startUpdate', async (_e, cols: number, rows: number) => {
    if (alivePtys().includes(UPDATE_ID)) return
    const argv = [(await loginEnv()).claude, '/revisao-demandas', '--settings', settingsPath]
    startPty(UPDATE_ID, argv, DIGITALK_HOME, await env(UPDATE_ID), cols, rows, ptyEvents)
  })
  ipcMain.handle('tasks:root', () => BRAIN_TASKS)
  // clique na notificação: traz a janela pra frente
  ipcMain.on('win:focus', () => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  ipcMain.handle('task:readme', (_e, id: string) =>
    readFile(task(id).readmePath, 'utf8').catch(() => '')
  )
  // abas avulsas: claude sem task ou terminal puro, em ~/Documents/Digitalk
  ipcMain.handle('pty:startScratch', async (_e, id: string, cols: number, rows: number) => {
    const kind = id.match(/^~(claude|shell)-\d+$/)?.[1]
    if (!kind) throw new Error(`aba inválida: ${id}`)
    if (alivePtys().includes(id)) return
    const argv =
      kind === 'claude'
        ? [(await loginEnv()).claude, '--settings', settingsPath]
        : [process.env.SHELL || '/bin/bash', '-i']
    startPty(id, argv, DIGITALK_HOME, await env(id), cols, rows, ptyEvents)
  })
  ipcMain.on('pty:write', (_e, id: string, d: string) => writePty(id, d))
  // rascunho: só limpa no renderer se a sessão ainda estava viva pra receber
  ipcMain.handle('pty:send', (_e, id: string, d: string) => {
    if (!alivePtys().includes(id)) return false
    writePty(id, d)
    setTimeout(() => writePty(id, '\r'), 60) // Enter separado: o claude fecha o paste antes
    return true
  })
  ipcMain.on('pty:resize', (_e, id: string, c: number, r: number) => resizePty(id, c, r))
  ipcMain.on('pty:kill', (_e, id: string) => {
    uuidOf.delete(id)
    killPty(id)
  })
  ipcMain.handle('task:sessions', async (_e, id: string): Promise<SessionInfo[]> =>
    Promise.all(
      [...task(id).sessions].reverse().map(async (s) => ({
        ...s,
        exists: !!(await findSessionFile(s.uuid)),
        current: uuidOf.get(id) === s.uuid
      }))
    )
  )
  ipcMain.handle('settings:path', () => settingsPath)
  ipcMain.handle('header:cached', (_e, id: string) => readCache(task(id)))
  ipcMain.handle('header:get', (_e, id: string, force: boolean) => getHeader(task(id), force))

  return () => {
    unwatchCfg()
    killAll()
    unwatch()
    hooks.close()
  }
}
