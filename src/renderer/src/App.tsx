import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { cleanLayout, DEFAULT_UI, SIDEBAR_DEFAULT, type Density } from '../../shared/uiFile'
import type { TaskRow } from '../../shared/contracts'
import type { ConfigState, Task, TaskState } from '../../shared/types'
import {
  Action,
  HOME,
  isFixedTab,
  reduce,
  scratchId,
  SETTINGS,
  tabLabel,
  windowTitle
} from './layout'
import { HomeView } from './HomeView'
import { Sidebar } from './Sidebar'
import { Panels } from './Panels'
import { disposeTerm, getTerm, hasTerm, liveTerms } from './terms'
import { Palette } from './Palette'
import { ShortcutDialog } from './ShortcutDialog'
import { activeBindings, bindCommand, shortcutOverrides } from './commands'
import { type NewAction } from './palette'
import { NewMenu } from './NewMenu'
import { ProjectDialog } from './ProjectDialog'
import { termsToDispose } from './live'
import { applyTheme } from './theme'
import { isTextField } from './focus'
import { notifyText, shouldNotify, type HookInfo } from './notify'
import { Icon } from './Icon'
import { appCommand, commandId, setCommandBindings } from './shortcuts'
import { SHELL_COPY } from '../../shared/copy/shell'
import { unwrap } from './ipc'
import { createUiSaver } from './uiSave'
import { coalesce } from './coalesce'
import { DONE_WINDOWS, doneSince } from './homeBoard'
import { TOAST_MS } from './taskFace'
import { Toast } from './ui/Toast'

export type Live = {
  states: Record<string, TaskState>
  alive: Set<string>
  exited: Record<string, number>
}

const RELOAD_MS = 100
const ATTENTION_ENTITIES = new Set(['task', 'session', 'project', 'flow'])

/** Nome curto de uma aba de task: key e título, venha ela do brain ou do domínio. */
export type TabName = { key: string; title: string }

function App(): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([])
  const [brainLoaded, setBrainLoaded] = useState(false)
  // linhas do domínio das abas abertas (ULID): rótulo da aba e prova de que a task existe
  const [tabRows, setTabRows] = useState<Map<string, TaskRow>>(new Map())
  const [domainTick, setDomainTick] = useState(0)
  const [layout, dispatch] = useReducer(reduce, { panels: [], focused: 0 })
  const [hydrated, setHydrated] = useState(false)
  // Ações do usuário antes do ui.json chegar: o restore não pode apagá-las, então são repetidas
  // em cima do layout restaurado.
  const early = useRef<Action[] | null>([])
  const act = useCallback((a: Action) => {
    early.current?.push(a)
    dispatch(a)
  }, [])
  const [extra, setExtra] = useState({
    home: DEFAULT_UI.home,
    fab: DEFAULT_UI.fab,
    density: DEFAULT_UI.density,
    shortcuts: DEFAULT_UI.shortcuts
  })
  const [attention, setAttention] = useState<TaskRow[]>([])
  const [showDone, setShowDone] = useState(false)
  const [doneRows, setDoneRows] = useState<TaskRow[]>([])
  const [doneWindow, setDoneWindow] = useState(0)
  const [sb, setSb] = useState<{ folded: boolean; width: number }>({
    folded: false,
    width: SIDEBAR_DEFAULT
  })
  const saver = useRef(
    createUiSaver(
      (file) => void unwrap(window.turnflow.uiSet({ ...file, layout: cleanLayout(file.layout) }))
    )
  )
  const [live, setLive] = useState<Live>({ states: {}, alive: new Set(), exited: {} })

  // Aviso do sistema (igual Cursor) quando um claude passa a esperar você e você não está vendo a aba.
  // Listener registrado uma vez: lê layout/config/tasks atuais por ref.
  const now = useRef({
    layout,
    cfg: null as ConfigState | null,
    names: new Map<string, TabName>()
  })
  const lastNotified = useRef(new Map<string, number>())
  const notifyPending = (id: string, st: TaskState, info: HookInfo): void => {
    const { layout: l, cfg: c, names: ns } = now.current
    const visible = l.panels.some((p) => p.tabs[p.active] === id)
    const ok = shouldNotify({
      state: st,
      enabled: c?.config.notifications ?? true,
      watching: document.hasFocus() && visible,
      lastAt: lastNotified.current.get(id) ?? 0,
      now: Date.now()
    })
    const text = notifyText(id.startsWith('~') ? tabLabel(id) : (ns.get(id)?.key ?? id), info)
    if (!ok || !text) return
    lastNotified.current.set(id, Date.now())
    const title = ns.get(id)?.title
    const n = new Notification(text.title, {
      body: title ? `${title}\n${text.body}` : text.body,
      silent: false
    })
    n.onclick = () => {
      window.turnflow.focusWindow()
      act({ t: 'open', taskId: id })
    }
  }

  useEffect(() => {
    unwrap(window.turnflow.listTasks()).then((t) => {
      if (!t) return
      setTasks(t)
      setBrainLoaded(true)
    })
    const offs = [
      window.turnflow.onTasksChanged(setTasks),
      window.turnflow.onState((id, st, info) => {
        setLive((l) => ({ ...l, states: { ...l.states, [id]: st } }))
        if (info) notifyPending(id, st, info)
      }),
      window.turnflow.onExit((id, code) =>
        setLive((l) => {
          const alive = new Set(l.alive)
          alive.delete(id)
          return { ...l, alive, exited: { ...l.exited, [id]: code } }
        })
      )
    ]
    return () => offs.forEach((f) => f())
  }, [])

  // Rajada de domain.changed (import, sync, a IA mexendo) vira poucas recargas: uma por janela de
  // 100 ms, nunca duas no ar ao mesmo tempo.
  useEffect(() => {
    let cancel = false
    const loader = coalesce(async () => {
      const rows = await unwrap(window.turnflow.taskList({ scope: 'attention' }))
      if (!cancel && rows) setAttention(rows)
    }, RELOAD_MS)
    void unwrap(window.turnflow.taskList({ scope: 'attention' })).then((rows) => {
      if (!cancel && rows) setAttention(rows)
    })
    const off = window.turnflow.onDomainChanged((change) => {
      if (!ATTENTION_ENTITIES.has(change.entity)) return
      loader.trigger()
      setDomainTick((n) => n + 1)
    })
    return () => {
      cancel = true
      loader.cancel()
      off()
    }
  }, [])

  // Concluídas: só com o filtro aberto e por janela de tempo (§7 `done_since`); "Show older" alarga.
  useEffect(() => {
    if (!showDone) return
    let cancel = false
    const load = async (): Promise<void> => {
      const since = doneSince(doneWindow, Date.now())
      const rows = await unwrap(
        window.turnflow.taskList({ scope: since ? { done_since: since } : {} })
      )
      if (!cancel && rows) setDoneRows(rows)
    }
    void load()
    const loader = coalesce(load, RELOAD_MS)
    const off = window.turnflow.onDomainChanged((change) => {
      if (change.entity === 'task') loader.trigger()
    })
    return () => {
      cancel = true
      loader.cancel()
      off()
    }
  }, [showDone, doneWindow])

  useEffect(() => {
    let cancel = false
    void unwrap(window.turnflow.uiGet()).then((file) => {
      if (cancel) return
      const pending = early.current ?? []
      early.current = null
      if (file) {
        dispatch({ t: 'restore', layout: file.layout })
        pending.forEach(dispatch)
        setSb(file.sidebar)
        setExtra({
          home: file.home,
          fab: file.fab,
          density: file.density,
          shortcuts: file.shortcuts
        })
      }
      setHydrated(true)
    })
    return () => {
      cancel = true
    }
  }, [])

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const openIds = useMemo(() => new Set(layout.panels.flatMap((p) => p.tabs)), [layout])
  const names = useMemo(() => {
    const m = new Map<string, TabName>()
    for (const t of tasks) m.set(t.id, { key: t.id, title: t.title })
    for (const r of [...doneRows, ...attention, ...tabRows.values()])
      m.set(r.id, { key: r.key, title: r.title })
    return m
  }, [tasks, doneRows, attention, tabRows])
  const domainKeys = useMemo(
    () => new Set([...doneRows, ...attention, ...tabRows.values()].map((r) => r.key)),
    [doneRows, attention, tabRows]
  )
  // abas de task que não são do brain: candidatas a task do domínio (id = ULID)
  const domainTabs = useMemo(
    () =>
      [...openIds]
        .filter((id) => !isFixedTab(id) && !byId.has(id))
        .sort()
        .join('\n'),
    [openIds, byId]
  )

  const markStarted = useCallback((id: string) => {
    setLive((l) => {
      const exited = { ...l.exited }
      delete exited[id]
      return {
        ...l,
        alive: new Set(l.alive).add(id),
        exited,
        states: { ...l.states, [id]: 'working' }
      }
    })
  }, [])

  const endSession = useCallback((id: string) => window.turnflow.kill({ id }), [])

  // aba fechada + processo morto: o xterm não tem mais por que existir
  useEffect(() => {
    termsToDispose(live.exited, openIds).forEach(disposeTerm)
  }, [live.exited, openIds])

  useEffect(() => {
    if (!hydrated) return
    saver.current.push({
      version: 1,
      layout,
      sidebar: sb,
      home: extra.home,
      fab: extra.fab,
      density: extra.density,
      shortcuts: extra.shortcuts
    })
  }, [hydrated, layout, sb, extra])
  // fechar/recarregar a janela não espera o debounce de 500 ms
  useEffect(() => {
    const saveNow = (): void => saver.current.flush()
    window.addEventListener('pagehide', saveNow)
    window.addEventListener('beforeunload', saveNow)
    return () => {
      window.removeEventListener('pagehide', saveNow)
      window.removeEventListener('beforeunload', saveNow)
      saveNow()
    }
  }, [])
  const [root, setRoot] = useState('')
  // a pasta muda sem reiniciar (import grava brainDir): relê a cada lista nova
  useEffect(() => {
    unwrap(window.turnflow.tasksRoot()).then((r) => r !== undefined && setRoot(r))
  }, [tasks])
  const [cfg, setCfg] = useState<ConfigState | null>(null)
  useEffect(() => {
    now.current = { layout, cfg, names }
  }, [layout, cfg, names])
  useEffect(() => {
    unwrap(window.turnflow.config()).then((c) => c && setCfg(c))
    return window.turnflow.onConfig(setCfg)
  }, [])
  useEffect(() => {
    if (cfg) applyTheme(cfg.theme, cfg.config)
  }, [cfg])

  // paleta aberta: `search` acha primeiro; `new` (+ Novo > Task) cria primeiro
  const [searching, setSearching] = useState<false | 'search' | 'new'>(false)
  const [newTabPanel, setNewTabPanel] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [shortcutOpen, setShortcutOpen] = useState(false)
  const [notice, setNotice] = useState('')
  // Desfazer da última ação (§4): mora aqui para sobreviver a trocar ou fechar a aba da task
  const [undo, setUndo] = useState<{ activityId: string; text: string } | null>(null)
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [undo])
  const onUndoable = useCallback(
    (activityId: string, text: string) => setUndo({ activityId, text }),
    []
  )
  const runUndo = (): void => {
    if (!undo) return
    const { activityId } = undo
    setUndo(null)
    void window.turnflow.activityUndo({ activity_id: activityId }).then((r) => {
      if (!r.ok) setNotice(r.error.message)
    })
  }
  const [paletteTypes, setPaletteTypes] = useState<{ id: string; name: string }[]>([])
  const [paletteProjects, setPaletteProjects] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (!searching && projectName === null) return
    void unwrap(window.turnflow.taskTypeList()).then((rows) => {
      if (rows) setPaletteTypes(rows.map((row) => ({ id: row.id, name: row.name })))
    })
    void unwrap(window.turnflow.projectList()).then((rows) => {
      if (rows) setPaletteProjects(rows.map((row) => ({ id: row.id, name: row.name })))
    })
  }, [searching, projectName])
  useEffect(() => {
    setCommandBindings(activeBindings(extra.shortcuts))
  }, [extra.shortcuts])
  const onBind = useCallback((id: string, code: string) => {
    setExtra((current) => ({
      ...current,
      shortcuts: shortcutOverrides(bindCommand(activeBindings(current.shortcuts), id, code))
    }))
  }, [])
  const newTab = useCallback(
    (kind: NewAction, panel: number) => {
      if (layout.panels[panel]) act({ t: 'focusAt', panel })
      if (kind === 'task') setSearching('new')
      else if (kind === 'project') setProjectName('')
      else
        act({
          t: 'open',
          taskId: scratchId(
            kind === 'terminal' ? 'shell' : 'claude',
            layout,
            new Set([...live.alive, ...liveTerms()])
          )
        })
    },
    [layout, live.alive]
  )
  // título da janela = aba ativa de cada painel (ex.: "T-5030 │ T-4802 — <nome do app>")
  useEffect(() => {
    document.title = windowTitle(layout, (id) => names.get(id)?.key)
  }, [layout, names])
  // Restore e mudanças do domínio: aba de task que não existe nem no brain nem no domínio sai do
  // layout. Sem lista do brain (pasta vazia ou ainda carregando) não dá pra dizer que uma aba
  // não-domínio sumiu: nesse caso nada sai.
  useEffect(() => {
    if (!hydrated || !brainLoaded) return
    const ids = domainTabs ? domainTabs.split('\n') : []
    let cancel = false
    void (async () => {
      const rows = ids.length
        ? await unwrap(window.turnflow.taskList({ scope: { ids } }))
        : ([] as TaskRow[])
      if (cancel || !rows) return
      setTabRows(new Map(rows.map((r) => [r.id, r])))
      if (!tasks.length) return
      dispatch({ t: 'retain', ids: new Set([...tasks.map((t) => t.id), ...rows.map((r) => r.id)]) })
    })()
    return () => {
      cancel = true
    }
  }, [tasks, hydrated, brainLoaded, domainTabs, domainTick])
  const activeId = layout.panels[layout.focused]?.tabs[layout.panels[layout.focused].active]

  const toggleDraft = useCallback(() => {
    if (cfg)
      unwrap(window.turnflow.setConfig({ draftMode: !cfg.config.draftMode })).then(
        (c) => c && setCfg(c)
      )
  }, [cfg])

  const focusActive = useCallback(() => {
    if (activeId && hasTerm(activeId)) requestAnimationFrame(() => getTerm(activeId).term.focus())
  }, [activeId])

  // Um executor só para teclado e paleta (E6.5): o comando faz a mesma coisa venha de onde vier.
  const runCommand = (id: string): void => {
    const term = activeId && hasTerm(activeId) ? getTerm(activeId).term : null
    const tab = /^tab-(\d)$/.exec(id)
    if (id === 'draft') toggleDraft()
    else if (id === 'newTab') setNewTabPanel(layout.panels.length ? layout.focused : null)
    else if (id === 'search') setSearching('search')
    else if (id === 'new') setCreating(true)
    else if (id === 'sync') setNotice(SHELL_COPY.syncOff)
    else if (id === 'shortcuts') setShortcutOpen(true)
    else if (id === 'split') {
      act({ t: 'split' })
      setSearching('search')
    } else if (id === 'closeTab') {
      if (activeId) act({ t: 'close', taskId: activeId })
      else if (layout.panels.length) act({ t: 'dropPanel', panel: layout.focused })
    } else if (id === 'sidebar') {
      // igual Ctrl+B do VS Code: mostra/esconde a lista; ao mostrar, o foco vai pra ela
      setSb((x) => ({ ...x, folded: !x.folded }))
      if (sb.folded)
        requestAnimationFrame(() =>
          document
            .getElementById('sidebar')
            ?.querySelector<HTMLElement>(
              '[role="option"][tabindex="0"], .open-main.is-open, .item.is-open, .open-main, .item'
            )
            ?.focus()
        )
      else focusActive()
    } else if (id === 'copy') {
      const sel = term?.getSelection()
      if (sel) window.turnflow.writeClipboard({ text: sel })
    } else if (id === 'paste') {
      unwrap(window.turnflow.readClipboard()).then((c) => c?.text && term?.paste(c.text))
    } else if (tab) act({ t: 'focusTab', n: Number(tab[1]) })
    else if (id === 'panel-prev' || id === 'panel-next')
      act({ t: 'focusPanel', dir: id === 'panel-prev' ? -1 : 1 })
    else if (id === 'cycle-prev' || id === 'cycle-next')
      act({ t: 'cycleTab', dir: id === 'cycle-prev' ? -1 : 1 })
  }
  const runRef = useRef(runCommand)
  useEffect(() => {
    runRef.current = runCommand
  })

  // Atalhos do app: só Ctrl+Shift. Capture na window pra rodar antes do xterm.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (shortcutOpen) return
      const cmd = appCommand(e, activeBindings(extra.shortcuts))
      if (!cmd) return
      e.preventDefault()
      e.stopPropagation()
      const typing = isTextField(document.activeElement as HTMLElement | null)
      // copiar/colar com foco num campo de texto (busca, rascunho): deixa o nativo agir
      if ((cmd === 'copy' || cmd === 'paste') && typing) {
        if (cmd === 'copy') document.execCommand('copy')
        else
          unwrap(window.turnflow.readClipboard()).then(
            (c) => c?.text && document.execCommand('insertText', false, c.text)
          )
        return
      }
      runRef.current(commandId(cmd))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [shortcutOpen, extra.shortcuts])

  const search = useCallback(
    async (q: string) => (await unwrap(window.turnflow.searchQuery({ q, limit: 30 }))) ?? [],
    []
  )

  return (
    <div className="app" data-testid="app-shell">
      <Sidebar
        tasks={tasks}
        openIds={openIds}
        live={live}
        onOpen={(id) => act({ t: 'open', taskId: id })}
        onPeek={(id) => act({ t: 'peek', taskId: id })}
        onEnd={endSession}
        onSearch={() => setSearching('search')}
        root={root}
        folded={sb.folded}
        width={sb.width}
        attention={attention}
        domainKeys={domainKeys}
        density={extra.density}
        onDensity={(density: Density) => setExtra((x) => ({ ...x, density }))}
        onToggle={() => setSb((x) => ({ ...x, folded: !x.folded }))}
        onWidth={(w) => setSb((x) => ({ ...x, width: w }))}
        icons={cfg?.config.statusIcons}
        actions={
          <>
            <button
              data-nav
              className={cfg?.config.draftMode ? 'on' : ''}
              title={`Draft mode ${cfg?.config.draftMode ? 'ligado' : 'desligado'} (Ctrl+Shift+D)`}
              onClick={toggleDraft}
            >
              <Icon name="pencil" />
            </button>
            <button
              data-nav
              title="Configurações: tema e fonte"
              onClick={() => act({ t: 'open', taskId: SETTINGS })}
            >
              <Icon name="settings" />
            </button>
            <button data-nav title="Home" onClick={() => act({ t: 'open', taskId: HOME })}>
              <Icon name="file" />
            </button>
            <button
              data-nav
              title="Buscar task (Ctrl+Shift+K)"
              onClick={() => setSearching('search')}
            >
              <Icon name="search" />
            </button>
          </>
        }
      />
      <Panels
        layout={layout}
        byId={byId}
        names={names}
        live={live}
        act={act}
        onStarted={markStarted}
        onEnd={endSession}
        onUndoable={onUndoable}
        draft={!!cfg?.config.draftMode}
        newTabPanel={newTabPanel}
        setNewTabPanel={setNewTabPanel}
        onNewTab={newTab}
        cfg={cfg}
        setCfg={setCfg}
        home={
          <HomeView
            rows={attention}
            doneRows={doneRows}
            mode={extra.home}
            showDone={showDone}
            onMode={(home) => setExtra((x) => ({ ...x, home }))}
            onToggleDone={() => setShowDone((v) => !v)}
            onOlder={
              doneWindow < DONE_WINDOWS.length ? () => setDoneWindow((w) => w + 1) : undefined
            }
            onOpen={(id) => act({ t: 'open', taskId: id })}
          />
        }
      />
      {searching && (
        <Palette
          mode={searching}
          brain={tasks}
          recent={attention.map((row) => ({
            id: row.id,
            key: row.key,
            title: row.title,
            done: false
          }))}
          search={search}
          types={paletteTypes}
          projects={paletteProjects}
          onPickTask={(id) => {
            setSearching(false)
            act({ t: 'open', taskId: id })
          }}
          onCreate={async (item) => {
            const result = await window.turnflow.taskCreate({
              title: item.title,
              type_id: item.typeId,
              ...(item.projectId ? { project_id: item.projectId } : {})
            })
            if (!result.ok) return result.error.message
            if (!result.data.row) return SHELL_COPY.palette.createFailed
            setSearching(false)
            act({ t: 'open', taskId: result.data.row.id })
            return null
          }}
          onCommand={(id) => {
            setSearching(false)
            runCommand(id)
          }}
          onClose={() => {
            setSearching(false)
            focusActive()
          }}
        />
      )}
      {creating && (
        <div className="overlay" onMouseDown={() => setCreating(false)}>
          <div onMouseDown={(event) => event.stopPropagation()}>
            <NewMenu
              className="new-overlay"
              onClose={() => setCreating(false)}
              onPick={(kind) => {
                setCreating(false)
                newTab(kind, layout.focused)
              }}
            />
          </div>
        </div>
      )}
      {projectName !== null && (
        <ProjectDialog
          onClose={() => setProjectName(null)}
          onCreate={async (name) => {
            const result = await window.turnflow.projectCreate({ name })
            if (!result.ok) return result.error.message
            setProjectName(null)
            setNotice(SHELL_COPY.project.created(result.data.name))
            return null
          }}
        />
      )}
      {shortcutOpen && (
        <ShortcutDialog
          bindings={activeBindings(extra.shortcuts)}
          onBind={onBind}
          onClose={() => setShortcutOpen(false)}
        />
      )}
      {undo && (
        <div className="app-toast">
          <Toast action={SHELL_COPY.undo} onAction={runUndo}>
            {undo.text}
          </Toast>
        </div>
      )}
      {notice && (
        <div className="app-notice" role="status">
          {notice}
        </div>
      )}
    </div>
  )
}

export default App
