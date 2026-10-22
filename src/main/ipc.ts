import { BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { execFile } from 'child_process'
import { appendFileSync } from 'fs'
import { join } from 'path'
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
  watchConfig,
  writeConfig
} from './appConfig'
import { access, readFile } from 'fs/promises'
import type { Events } from '../shared/ipc/events'
import type { Channel } from '../shared/ipc/define'
import * as C from '../shared/ipc/registry'
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
import { createPtyGuard } from './ptyGuard'
import { findSessionFile, runningElsewhere } from './sessions'
import { loadTasks, watchTasks } from './tasks'
import { getHeader, readCache } from './header'
import { handle as handleOn, IpcError, type Handler, type IpcLike } from './ipc/handle'
import { registerPtyIo } from './ipc/ptyIo'

export const UPDATE_ID = '__update__'

export async function registerIpc(win: BrowserWindow, ipc: IpcLike = ipcMain): Promise<() => void> {
  // guard primeiro: adopt() e o exit dos ptys usam ele, e podem rodar antes do fim do registro
  const guard = createPtyGuard()
  const owner = win.webContents.id
  const send = <K extends keyof Events>(ch: K, ...a: Events[K]): void => {
    if (!win.isDestroyed()) win.webContents.send(ch, ...a)
  }
  const handle = <Ch extends Channel>(ch: Ch, fn: Handler<Ch>): void =>
    handleOn(ipc, ch, fn, { validateOutput: is.dev })
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
      guard.release(from)
      guard.register(to, owner)
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
    if (!t) throw new IpcError('NOT_FOUND', `task ${id} não encontrada`)
    return t
  }
  const ptyEvents = {
    data: (id: string, d: string) => send('pty:data', id, d),
    exit: (id: string, code: number) => {
      uuidOf.delete(id)
      guard.release(id)
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

  handle(C.CHANNELS.readClipboard, async () => ({
    text: await clipboard.readText(),
    image: await clipboard.has('image/png')
  }))
  handle(C.CHANNELS.writeClipboard, ({ text }) => clipboard.writeText(text))
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

  handle(C.CHANNELS.listTasks, () => reload())
  handle(C.CHANNELS.plan, ({ id, uuid }) => resolveLaunch(task(id), depsFor(id), uuid))
  handle(C.CHANNELS.start, async ({ id, how, cols, rows }) => {
    if (alivePtys().includes(id)) return // start duplicado (duplo clique): o primeiro já subiu
    const t = task(id)
    let cwd = DIGITALK_HOME
    if ('resume' in how) {
      // revalida logo antes de lançar: a sessão pode ter sido aberta fora nesse meio tempo
      const plan = await resolveLaunch(t, depsFor(id), how.resume)
      if (plan.kind === 'elsewhere')
        throw new IpcError(
          'CONFLICT',
          plan.by
            ? `essa conversa já está aberta na aba ${plan.by}`
            : `sessão aberta fora do ${BRAND.name} (PID ${plan.pid})`
        )
      if (plan.kind === 'gone')
        throw new IpcError('NOT_FOUND', `a pasta dessa sessão não existe mais: ${plan.cwd}`)
      if (plan.kind !== 'resume') throw new IpcError('NOT_FOUND', 'sessão não existe mais')
      cwd = plan.cwd || DIGITALK_HOME
    }
    const [, ...args] = claudeArgv(t, settingsPath, how)
    const bin = (await loginEnv()).claude
    if (alivePtys().includes(id)) return
    startPty(id, [bin, ...args], cwd, await env(id), cols, rows, ptyEvents)
    guard.register(id, owner)
    if ('resume' in how) uuidOf.set(id, how.resume)
  })
  // comando fixo: o renderer não escolhe o que executar
  handle(C.CHANNELS.startUpdate, async ({ cols, rows }) => {
    if (alivePtys().includes(UPDATE_ID)) return
    const argv = [(await loginEnv()).claude, '/revisao-demandas', '--settings', settingsPath]
    startPty(UPDATE_ID, argv, DIGITALK_HOME, await env(UPDATE_ID), cols, rows, ptyEvents)
    guard.register(UPDATE_ID, owner)
  })
  handle(C.CHANNELS.tasksRoot, () => BRAIN_TASKS)
  // clique na notificação: traz a janela pra frente
  handle(C.CHANNELS.focusWindow, () => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  handle(C.CHANNELS.readme, ({ id }) => readFile(task(id).readmePath, 'utf8').catch(() => ''))
  // abas avulsas: claude sem task ou terminal puro, em ~/Documents/Digitalk
  handle(C.CHANNELS.startScratch, async ({ id, cols, rows }) => {
    const kind = id.match(/^~(claude|shell)-\d+$/)?.[1]
    if (!kind) throw new IpcError('VALIDATION', `aba inválida: ${id}`)
    if (alivePtys().includes(id)) return
    const argv =
      kind === 'claude'
        ? [(await loginEnv()).claude, '--settings', settingsPath]
        : [process.env.SHELL || '/bin/bash', '-i']
    startPty(id, argv, DIGITALK_HOME, await env(id), cols, rows, ptyEvents)
    guard.register(id, owner)
  })
  registerPtyIo(ipc, {
    guard,
    pty: { write: writePty, resize: resizePty, kill: killPty, alive: alivePtys },
    onKill: (id) => uuidOf.delete(id)
  })
  handle(C.CHANNELS.sessionInfo, async ({ id }) =>
    Promise.all(
      [...task(id).sessions].reverse().map(async (s) => ({
        ...s,
        exists: !!(await findSessionFile(s.uuid)),
        current: uuidOf.get(id) === s.uuid
      }))
    )
  )
  handle(C.CHANNELS.settingsPath, () => settingsPath)
  handle(C.CHANNELS.headerCached, ({ id }) => readCache(task(id)))
  handle(C.CHANNELS.header, ({ id, force }) => getHeader(task(id), force))

  return () => {
    unwatchCfg()
    killAll()
    unwatch()
    hooks.close()
  }
}
