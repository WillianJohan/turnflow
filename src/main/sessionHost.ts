import { randomBytes } from 'crypto'
import type { SessionState } from '../shared/contracts'
import type { DomainDeps } from '../core/domain/context'
import { notFound } from '../core/domain/errors'
import { getTask } from '../core/domain/rows'
import {
  discardOpened,
  endLiveSessions,
  endSession,
  getSession,
  listSessions,
  openSession,
  recordSessionStart,
  reopenSession,
  sessionError,
  setSessionState,
  type OpenedSession,
  type SessionTool
} from '../core/domain/session'
import { noteUserPrompt } from '../core/domain/turn'
import { IpcError } from './ipc/handle'
import { hookEffect, type HookBody } from './hooks'
import { agentArgv, launchDir, sessionEnv, shellArgv, type AgentCommands } from './launch'
import { createPtyPool, type PtySpawner } from './pty'

export type SpawnInput =
  | {
      pty_id: string
      cols: number
      rows: number
      kind: 'agent'
      tool: SessionTool
      /** Id ou key da task. `null` abre scratch. */
      task: string | null
      /** `session_id` de uma sessão encerrada. */
      resume?: string
    }
  | { pty_id: string; cols: number; rows: number; kind: 'shell' }

export type SessionHostDeps = {
  spawner: PtySpawner
  domain(): DomainDeps | null
  bins(): Promise<AgentCommands>
  path(): Promise<string>
  settingsPath: string
  socketPath: string
  hookPort(): number
  defaultWorkdir(): string | null
  home: string
  platform: NodeJS.Platform
  dirExists(p: string): Promise<boolean>
  findTranscript(uuid: string): Promise<{ cwd: string } | null>
  runningElsewhere(uuid: string, ownPids: Set<number>, tool: SessionTool): Promise<number | null>
  events: {
    data(ptyId: string, d: string): void
    exit(ptyId: string, code: number): void
    state(ptyId: string, s: SessionState, info?: { event: string; message?: string }): void
  }
  log(line: string): void
  /** Padrão: 32 bytes em hex. O token fica só na memória e no env do PTY. */
  newToken?: () => string
}

type Entry = {
  session_id: string | null
  client_id: string | null
  token: string | null
  tool: SessionTool | 'shell'
  state: SessionState | null
  killed: boolean
}

export type SessionHost = {
  spawn(i: SpawnInput): Promise<{ session_id: string | null }>
  write(ptyId: string, d: string): void
  resize(ptyId: string, c: number, r: number): void
  kill(ptyId: string): void
  accept(token: string): boolean
  onHook(token: string, b: HookBody): void
  stateOf(ptyId: string): SessionState | null
  alive(): string[]
  onVaultReady(d: DomainDeps): void
  onVaultLeft(): void
  killAllAndWait(ms: number): Promise<void>
}

export function createSessionHost(o: SessionHostDeps): SessionHost {
  const entries = new Map<string, Entry>()
  const byToken = new Map<string, string>()
  const codexTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const quietCodex = (id: string): void => {
    const timer = codexTimers.get(id)
    if (timer) clearTimeout(timer)
    codexTimers.delete(id)
  }

  const bumpCodex = (id: string): void => {
    const entry = entries.get(id)
    if (!entry || entry.tool !== 'codex') return
    if (entry.state !== 'working') {
      entry.state = 'working'
      o.events.state(id, 'working', { event: 'output' })
      const d = o.domain()
      if (d && entry.session_id) setSessionState(d, entry.session_id, 'working')
    }
    quietCodex(id)
    codexTimers.set(
      id,
      setTimeout(() => {
        codexTimers.delete(id)
        const cur = entries.get(id)
        if (!cur || cur.state !== 'working') return
        cur.state = 'unknown'
        o.events.state(id, 'unknown', { event: 'quiet' })
        const d = o.domain()
        if (d && cur.session_id) setSessionState(d, cur.session_id, 'unknown')
      }, 3000)
    )
  }

  const pool = createPtyPool({
    spawner: o.spawner,
    platform: o.platform,
    events: {
      data: (id, d) => {
        bumpCodex(id)
        o.events.data(id, d)
      },
      exit: (id, code) => {
        quietCodex(id)
        const entry = entries.get(id)
        const d = o.domain()
        if (d && entry?.session_id)
          endSession(d, entry.session_id, entry.killed ? 'killed' : 'exit')
        if (entry?.token) byToken.delete(entry.token)
        entries.delete(id)
        o.events.exit(id, code)
      }
    }
  })

  const tokenOf = (): string => (o.newToken ?? (() => randomBytes(32).toString('hex')))()

  const forget = (ptyId: string): void => {
    const entry = entries.get(ptyId)
    if (entry?.token) byToken.delete(entry.token)
    entries.delete(ptyId)
  }

  const pinFixed = (entry: Entry, tool: SessionTool): void => {
    if (tool === 'cursor' || tool === 'other') entry.state = 'unknown'
  }

  const applyState = (ptyId: string, entry: Entry, state: SessionState, b: HookBody): void => {
    if (entry.state === state) return
    entry.state = state
    o.events.state(ptyId, state, {
      event: b.hook_event_name,
      ...(b.message !== undefined ? { message: b.message } : {})
    })
    const d = o.domain()
    if (d && entry.session_id) setSessionState(d, entry.session_id, state)
  }

  return {
    async spawn(i) {
      if (i.kind === 'shell') {
        if (entries.has(i.pty_id) && pool.alive().includes(i.pty_id)) return { session_id: null }
        const dir = launchDir(null, o.defaultWorkdir(), o.home)
        entries.set(i.pty_id, {
          session_id: null,
          client_id: null,
          token: null,
          tool: 'shell',
          state: null,
          killed: false
        })
        pool.start(
          i.pty_id,
          shellArgv(o.platform, process.env),
          'dir' in dir ? dir.dir : o.home,
          { PATH: await o.path() },
          { cols: i.cols, rows: i.rows }
        )
        return { session_id: null }
      }
      const d = o.domain()
      if (!d) throw new IpcError('LOCKED', 'vault locked')
      const live = entries.get(i.pty_id)
      if (live && pool.alive().includes(i.pty_id)) return { session_id: live.session_id }

      const task = i.task === null ? null : getTask(d, i.task)
      let cwd: string
      let opened: OpenedSession
      let resumeExternal: string

      if (i.resume) {
        const target = getSession(d, i.resume)
        if (!target) throw notFound('session', i.resume)
        const can =
          target.external_id !== null &&
          (target.tool === 'claude-code' || target.tool === 'codex') &&
          target.tool === i.tool
        if (!can) throw sessionError('VALIDATION', 'not_resumable')
        for (const [pty, entry] of entries) {
          if (pty === i.pty_id || !entry.session_id || !pool.alive().includes(pty)) continue
          if (entry.session_id === target.id)
            throw sessionError('CONFLICT', 'open_in_app', { pty_id: pty })
          const other = getSession(d, entry.session_id)
          if (other?.external_id === target.external_id && other.tool === target.tool)
            throw sessionError('CONFLICT', 'open_in_app', { pty_id: pty })
        }
        const transcript = await o.findTranscript(target.external_id!)
        if (!transcript) throw sessionError('NOT_FOUND', 'transcript_missing')
        const pid = await o.runningElsewhere(target.external_id!, pool.ownPids(), target.tool)
        if (pid) throw sessionError('CONFLICT', 'running_elsewhere', { pid })
        const launched = launchDir(
          task ? { workdir: task.workdir } : null,
          o.defaultWorkdir(),
          o.home
        )
        const picked = target.cwd || transcript.cwd || ('dir' in launched ? launched.dir : '')
        if (!picked) throw sessionError('CONFLICT', 'workdir_required')
        if (!(await o.dirExists(picked)))
          throw sessionError('NOT_FOUND', 'cwd_gone', { path: picked })
        cwd = picked
        opened = reopenSession(d, { session_id: target.id, cwd })
        resumeExternal = target.external_id!
      } else {
        const picked = launchDir(
          task ? { workdir: task.workdir } : null,
          o.defaultWorkdir(),
          o.home
        )
        if ('ask' in picked) throw sessionError('CONFLICT', 'workdir_required')
        if (!(await o.dirExists(picked.dir)))
          throw sessionError('NOT_FOUND', 'workdir_missing', { path: picked.dir })
        cwd = picked.dir
        const first = task ? listSessions(d, { task_id: task.id }).length === 0 : false
        opened = openSession(d, { task_id: task?.id ?? null, tool: i.tool, cwd })
        const launch = task
          ? {
              key: task.key,
              title: task.title,
              description: task.description,
              workdir: task.workdir,
              first_session: first
            }
          : null
        const token = tokenOf()
        const entry: Entry = {
          session_id: opened.session_id,
          client_id: opened.client_id,
          token,
          tool: i.tool,
          state: null,
          killed: false
        }
        entries.set(i.pty_id, entry)
        byToken.set(token, i.pty_id)
        try {
          pool.start(
            i.pty_id,
            agentArgv({
              tool: i.tool,
              bin: await o.bins(),
              task: launch,
              resume: null,
              settingsPath: o.settingsPath
            }),
            cwd,
            sessionEnv({
              path: await o.path(),
              token,
              port: o.hookPort(),
              socket: o.socketPath,
              taskKey: task?.key ?? null
            }),
            { cols: i.cols, rows: i.rows }
          )
        } catch (e) {
          forget(i.pty_id)
          discardOpened(d, opened)
          if (e instanceof Error && e.message === 'pty_busy')
            throw sessionError('CONFLICT', 'pty_busy')
          throw e
        }
        pinFixed(entry, i.tool)
        return { session_id: opened.session_id }
      }

      const token = tokenOf()
      const entry: Entry = {
        session_id: opened.session_id,
        client_id: opened.client_id,
        token,
        tool: i.tool,
        state: null,
        killed: false
      }
      entries.set(i.pty_id, entry)
      byToken.set(token, i.pty_id)
      const launch = task
        ? {
            key: task.key,
            title: task.title,
            description: task.description,
            workdir: task.workdir,
            first_session: false
          }
        : null
      try {
        pool.start(
          i.pty_id,
          agentArgv({
            tool: i.tool,
            bin: await o.bins(),
            task: launch,
            resume: resumeExternal,
            settingsPath: o.settingsPath
          }),
          cwd,
          sessionEnv({
            path: await o.path(),
            token,
            port: o.hookPort(),
            socket: o.socketPath,
            taskKey: task?.key ?? null
          }),
          { cols: i.cols, rows: i.rows }
        )
      } catch (e) {
        forget(i.pty_id)
        discardOpened(d, opened)
        if (e instanceof Error && e.message === 'pty_busy')
          throw sessionError('CONFLICT', 'pty_busy')
        throw e
      }
      pinFixed(entry, i.tool)
      return { session_id: opened.session_id }
    },

    write(ptyId, data) {
      const entry = entries.get(ptyId)
      if (entry && data === '\x1b' && entry.tool === 'claude-code' && entry.state === 'working')
        applyState(ptyId, entry, 'idle', { hook_event_name: 'esc' })
      pool.write(ptyId, data)
    },

    resize(ptyId, c, r) {
      pool.resize(ptyId, c, r)
    },

    kill(ptyId) {
      const entry = entries.get(ptyId)
      if (entry) entry.killed = true
      pool.kill(ptyId)
    },

    accept(token) {
      return byToken.has(token)
    },

    onHook(token, b) {
      const ptyId = byToken.get(token)
      const entry = ptyId ? entries.get(ptyId) : undefined
      if (
        !ptyId ||
        !entry ||
        entry.tool === 'shell' ||
        entry.tool === 'cursor' ||
        entry.tool === 'other'
      )
        return
      const effect = hookEffect(b)
      if (effect.ignoredType !== undefined) o.log(effect.ignoredType)
      else if (b.hook_event_name === 'Notification' && effect.state === null) o.log('')
      const d = o.domain()
      if (effect.start && entry.session_id && d) {
        const next = recordSessionStart(d, entry.session_id, {
          external_id: effect.start.external_id,
          cwd: effect.start.cwd
        })
        entry.session_id = next.session_id
      }
      if (effect.state) applyState(ptyId, entry, effect.state, b)
      if (effect.prompt && entry.session_id && d) {
        const taskId = getSession(d, entry.session_id)?.task_id
        if (taskId) noteUserPrompt(d, taskId)
      }
    },

    stateOf(ptyId) {
      return entries.get(ptyId)?.state ?? null
    },

    alive() {
      return pool.alive()
    },

    onVaultReady(d) {
      endLiveSessions(d)
    },

    onVaultLeft() {
      for (const [id, entry] of entries) {
        if (entry.tool === 'shell') continue
        entry.killed = true
        pool.kill(id)
      }
    },

    killAllAndWait(ms) {
      for (const entry of entries.values()) entry.killed = true
      return pool.killAllAndWait(ms)
    }
  }
}
