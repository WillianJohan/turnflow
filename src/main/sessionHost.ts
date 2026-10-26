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
  type SessionTool
} from '../core/domain/session'
import { noteUserPrompt } from '../core/domain/turn'
import { VAULT_COPY } from '../shared/copy/vault'
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
  /** Geração do processo no pool: só o exit dela encerra esta entrada. */
  gen: number
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
  /** Sessão atual do pty (muda numa fusão); `null` sem sessão. */
  sessionOf(ptyId: string): string | null
  alive(): string[]
  onVaultReady(d: DomainDeps): void
  onVaultLeft(): void
  killAllAndWait(ms: number): Promise<void>
}

const commandName = (bin: string | undefined): string =>
  (bin ?? '')
    .split(/[/\\]/)
    .pop()!
    .replace(/\.(exe|cmd|bat)$/i, '')

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
    log: o.log,
    events: {
      data: (id, d) => {
        bumpCodex(id)
        o.events.data(id, d)
      },
      exit: (id, code, gen) => {
        const entry = entries.get(id)
        // exit de um processo que não é o desta entrada: não encerra a sessão de ninguém
        if (entry && entry.gen !== gen) {
          o.log(`pty ${id}: exit of a stale process ignored`)
          return
        }
        quietCodex(id)
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

  /** Entrada do pty_id com processo vivo (clique duplo devolve a mesma sessão). */
  const running = (ptyId: string): Entry | null => {
    const entry = entries.get(ptyId)
    return entry && pool.alive().includes(ptyId) ? entry : null
  }

  // Erro conhecido do spawn vira DomainError com a copy; o resto segue cru (INTERNAL no IPC).
  // `tool` decide a copy do binário ausente: o claude não vem do config.json, os outros vêm.
  const startPty = (tool: SessionTool | 'shell', ...a: Parameters<typeof pool.start>): number => {
    try {
      return pool.start(...a)
    } catch (e) {
      if (!(e instanceof Error)) throw e
      if (e.message === 'pty_busy') throw sessionError('CONFLICT', 'pty_busy')
      // node-pty: ENOENT no POSIX, "File not found: …" no Windows
      if (
        (e as NodeJS.ErrnoException).code === 'ENOENT' ||
        /ENOENT|File not found/i.test(e.message)
      )
        throw tool === 'claude-code'
          ? sessionError('NOT_FOUND', 'claude_missing')
          : sessionError('NOT_FOUND', 'agent_missing', { command: commandName(a[1][0]) })
      throw e
    }
  }

  type Plan = { cwd: string; resume: { session_id: string; external: string } | null }

  // Validações com await (pasta, transcript, processo de fora). Não escreve nada.
  const planAgent = async (
    d: DomainDeps,
    i: Extract<SpawnInput, { kind: 'agent' }>
  ): Promise<Plan> => {
    const task = i.task === null ? null : getTask(d, i.task)
    const launched = launchDir(task ? { workdir: task.workdir } : null, o.defaultWorkdir(), o.home)
    if (!i.resume) {
      if ('ask' in launched) throw sessionError('CONFLICT', 'workdir_required')
      if (!(await o.dirExists(launched.dir)))
        throw sessionError('NOT_FOUND', 'workdir_missing', { path: launched.dir })
      return { cwd: launched.dir, resume: null }
    }
    const target = getSession(d, i.resume)
    if (!target) throw notFound('session', i.resume)
    // Codex: só retoma com o external_id que o E7 grava (o Codex não tem hook aqui, então o E5
    // nunca preenche). Sem ele cai em not_resumable.
    const can =
      target.external_id !== null &&
      (target.tool === 'claude-code' || target.tool === 'codex') &&
      target.tool === i.tool
    if (!can || target.external_id === null) throw sessionError('VALIDATION', 'not_resumable')
    const external = target.external_id
    for (const [pty, entry] of entries) {
      if (pty === i.pty_id || !entry.session_id || !pool.alive().includes(pty)) continue
      if (entry.session_id === target.id)
        throw sessionError('CONFLICT', 'open_in_app', { pty_id: pty })
      const other = getSession(d, entry.session_id)
      if (other?.external_id === external && other.tool === target.tool)
        throw sessionError('CONFLICT', 'open_in_app', { pty_id: pty })
    }
    const transcript = await o.findTranscript(external)
    if (!transcript) throw sessionError('NOT_FOUND', 'transcript_missing')
    const pid = await o.runningElsewhere(external, pool.ownPids(), target.tool)
    if (pid) throw sessionError('CONFLICT', 'running_elsewhere', { pid })
    const picked = target.cwd || transcript.cwd || ('dir' in launched ? launched.dir : '')
    if (!picked) throw sessionError('CONFLICT', 'workdir_required')
    if (!(await o.dirExists(picked))) throw sessionError('NOT_FOUND', 'cwd_gone', { path: picked })
    return { cwd: picked, resume: { session_id: target.id, external } }
  }

  return {
    async spawn(i) {
      // Todo await vem antes de mexer no estado: do fim deles até o registro é síncrono, então
      // nenhum exit ou outro start do mesmo pty_id cai no meio (Decisão 30).
      if (i.kind === 'shell') {
        if (running(i.pty_id)) return { session_id: null }
        const dir = launchDir(null, o.defaultWorkdir(), o.home)
        const PATH = await o.path()
        if (running(i.pty_id)) return { session_id: null }
        if (pool.busy(i.pty_id)) throw sessionError('CONFLICT', 'pty_busy')
        const gen = startPty(
          'shell',
          i.pty_id,
          shellArgv(o.platform, process.env),
          'dir' in dir ? dir.dir : o.home,
          { PATH },
          { cols: i.cols, rows: i.rows }
        )
        entries.set(i.pty_id, {
          gen,
          session_id: null,
          client_id: null,
          token: null,
          tool: 'shell',
          state: null,
          killed: false
        })
        return { session_id: null }
      }
      if (!o.domain()) throw new IpcError('LOCKED', VAULT_COPY.errors.LOCKED)
      const live = running(i.pty_id)
      if (live) return { session_id: live.session_id }

      const plan = await planAgent(o.domain()!, i)
      const bin = await o.bins()
      const PATH = await o.path()

      const d = o.domain()
      if (!d) throw new IpcError('LOCKED', VAULT_COPY.errors.LOCKED)
      const again = running(i.pty_id)
      if (again) return { session_id: again.session_id }
      if (pool.busy(i.pty_id)) throw sessionError('CONFLICT', 'pty_busy')

      const task = i.task === null ? null : getTask(d, i.task)
      const first =
        !plan.resume && task ? listSessions(d, { task_id: task.id }).length === 0 : false
      const argv = agentArgv({
        tool: i.tool,
        bin,
        task: task
          ? {
              key: task.key,
              title: task.title,
              description: task.description,
              workdir: task.workdir,
              first_session: first
            }
          : null,
        resume: plan.resume?.external ?? null,
        settingsPath: o.settingsPath
      })
      const opened = plan.resume
        ? reopenSession(d, { session_id: plan.resume.session_id, cwd: plan.cwd })
        : openSession(d, { task_id: task?.id ?? null, tool: i.tool, cwd: plan.cwd })
      const token = tokenOf()
      let gen: number
      try {
        gen = startPty(
          i.tool,
          i.pty_id,
          argv,
          plan.cwd,
          sessionEnv({
            path: PATH,
            token,
            port: o.hookPort(),
            socket: o.socketPath,
            taskKey: task?.key ?? null
          }),
          { cols: i.cols, rows: i.rows }
        )
      } catch (e) {
        discardOpened(d, opened)
        throw e
      }
      const entry: Entry = {
        gen,
        session_id: opened.session_id,
        client_id: opened.client_id,
        token,
        tool: i.tool,
        state: null,
        killed: false
      }
      entries.set(i.pty_id, entry)
      byToken.set(token, i.pty_id)
      pinFixed(entry, i.tool)
      return { session_id: opened.session_id }
    },

    write(ptyId, data) {
      const entry = entries.get(ptyId)
      // Esc sozinho interrompe (working) ou recusa a permissão (waiting): o claude volta ao prompt
      // sem mandar Stop. Default de produto: waiting também vira idle (Decisão 7 estendida).
      const interrupts = entry?.state === 'working' || entry?.state === 'waiting'
      if (entry && data === '\x1b' && entry.tool === 'claude-code' && interrupts)
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
      // só o claude-code muda estado por hook (§5): Codex, Cursor e Outra nunca
      if (!ptyId || !entry || entry.tool !== 'claude-code') return
      const effect = hookEffect(b)
      if (b.hook_event_name === 'Notification' && effect.state === null)
        o.log(`hook Notification ignored: type ${effect.ignoredType || '<none>'}`)
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

    sessionOf(ptyId) {
      return entries.get(ptyId)?.session_id ?? null
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
