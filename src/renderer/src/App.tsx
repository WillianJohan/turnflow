import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { DEFAULT_UI, SIDEBAR_DEFAULT } from '../../shared/uiFile'
import type { ConfigState, Task, TaskState } from '../../shared/types'
import { Action, reduce, scratchId, SETTINGS, tabLabel, windowTitle } from './layout'
import { Sidebar } from './Sidebar'
import { Panels } from './Panels'
import { disposeTerm, getTerm, hasTerm, liveTerms } from './terms'
import { Search } from './Search'
import { termsToDispose } from './live'
import { applyTheme } from './theme'
import { isTextField } from './focus'
import { notifyText, shouldNotify, type HookInfo } from './notify'
import { Icon } from './Icon'
import { appCommand } from './shortcuts'
import { unwrap } from './ipc'
import { createUiSaver } from './uiSave'

export type Live = {
  states: Record<string, TaskState>
  alive: Set<string>
  exited: Record<string, number>
}

function App(): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([])
  const [layout, dispatch] = useReducer(reduce, { panels: [], focused: 0 })
  const [hydrated, setHydrated] = useState(false)
  const [extra, setExtra] = useState({ home: DEFAULT_UI.home, fab: DEFAULT_UI.fab })
  const [sb, setSb] = useState<{ folded: boolean; width: number }>({
    folded: false,
    width: SIDEBAR_DEFAULT
  })
  const saver = useRef(createUiSaver((file) => void unwrap(window.turnflow.uiSet(file))))
  const [live, setLive] = useState<Live>({ states: {}, alive: new Set(), exited: {} })

  // Aviso do sistema (igual Cursor) quando um claude passa a esperar você e você não está vendo a aba.
  // Listener registrado uma vez: lê layout/config/tasks atuais por ref.
  const now = useRef({ layout, cfg: null as ConfigState | null, tasks: [] as Task[] })
  const lastNotified = useRef(new Map<string, number>())
  const notifyPending = (id: string, st: TaskState, info: HookInfo): void => {
    const { layout: l, cfg: c, tasks: ts } = now.current
    const visible = l.panels.some((p) => p.tabs[p.active] === id)
    const ok = shouldNotify({
      state: st,
      enabled: c?.config.notifications ?? true,
      watching: document.hasFocus() && visible,
      lastAt: lastNotified.current.get(id) ?? 0,
      now: Date.now()
    })
    const text = notifyText(id.startsWith('~') ? tabLabel(id) : id, info)
    if (!ok || !text) return
    lastNotified.current.set(id, Date.now())
    const title = ts.find((t) => t.id === id)?.title
    const n = new Notification(text.title, {
      body: title ? `${title}\n${text.body}` : text.body,
      silent: false
    })
    n.onclick = () => {
      window.turnflow.focusWindow()
      dispatch({ t: 'open', taskId: id })
    }
  }

  useEffect(() => {
    unwrap(window.turnflow.listTasks()).then((t) => t && setTasks(t))
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

  useEffect(() => {
    let cancel = false
    void unwrap(window.turnflow.uiGet()).then((file) => {
      if (cancel) return
      if (file) {
        dispatch({ t: 'restore', layout: file.layout })
        setSb(file.sidebar)
        setExtra({ home: file.home, fab: file.fab })
      }
      setHydrated(true)
    })
    return () => {
      cancel = true
    }
  }, [])

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const openIds = useMemo(() => new Set(layout.panels.flatMap((p) => p.tabs)), [layout])

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

  const act = useCallback((a: Action) => dispatch(a), [])
  useEffect(() => {
    if (!hydrated) return
    saver.current.push({ version: 1, layout, sidebar: sb, home: extra.home, fab: extra.fab })
  }, [hydrated, layout, sb, extra])
  useEffect(() => () => saver.current.flush(), [])
  const [root, setRoot] = useState('')
  // a pasta muda sem reiniciar (import grava brainDir): relê a cada lista nova
  useEffect(() => {
    unwrap(window.turnflow.tasksRoot()).then((r) => r !== undefined && setRoot(r))
  }, [tasks])
  const [cfg, setCfg] = useState<ConfigState | null>(null)
  useEffect(() => {
    now.current = { layout, cfg, tasks }
  }, [layout, cfg, tasks])
  useEffect(() => {
    unwrap(window.turnflow.config()).then((c) => c && setCfg(c))
    return window.turnflow.onConfig(setCfg)
  }, [])
  useEffect(() => {
    if (cfg) applyTheme(cfg.theme, cfg.config)
  }, [cfg])

  const [searching, setSearching] = useState(false)
  const [newTabPanel, setNewTabPanel] = useState<number | null>(null)
  const newTab = useCallback(
    (kind: 'claude' | 'shell' | 'task', panel: number) => {
      if (layout.panels[panel]) dispatch({ t: 'focusAt', panel })
      if (kind === 'task') setSearching(true)
      else
        dispatch({
          t: 'open',
          taskId: scratchId(kind, layout, new Set([...live.alive, ...liveTerms()]))
        })
    },
    [layout, live.alive]
  )
  // título da janela = aba ativa de cada painel (ex.: "T-5030 │ T-4802 — <nome do app>")
  useEffect(() => {
    document.title = windowTitle(layout)
  }, [layout])
  // restore: abas de tasks que sumiram do brain saem do layout
  useEffect(() => {
    if (!hydrated || !tasks.length) return
    dispatch({ t: 'retain', ids: new Set(tasks.map((t) => t.id)) })
  }, [tasks, hydrated])
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

  // Atalhos do app: só Ctrl+Shift. Capture na window pra rodar antes do xterm.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const cmd = appCommand(e)
      if (!cmd) return
      e.preventDefault()
      e.stopPropagation()
      const term = activeId && hasTerm(activeId) ? getTerm(activeId).term : null
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
      if (cmd === 'draft') toggleDraft()
      else if (cmd === 'newTab') setNewTabPanel(layout.panels.length ? layout.focused : null)
      else if (cmd === 'search') setSearching(true)
      else if (cmd === 'split') {
        act({ t: 'split' })
        setSearching(true)
      } else if (cmd === 'closeTab') {
        if (activeId) act({ t: 'close', taskId: activeId })
        else if (layout.panels.length) act({ t: 'dropPanel', panel: layout.focused })
      } else if (cmd === 'sidebar') {
        // igual Ctrl+B do VS Code: mostra/esconde a lista; ao mostrar, o foco vai pra ela
        setSb((x) => ({ ...x, folded: !x.folded }))
        if (sb.folded)
          requestAnimationFrame(() =>
            document
              .getElementById('sidebar')
              ?.querySelector<HTMLElement>('.open-main.is-open, .item.is-open, .open-main, .item')
              ?.focus()
          )
        else focusActive()
      } else if (cmd === 'copy') {
        const sel = term?.getSelection()
        if (sel) window.turnflow.writeClipboard({ text: sel })
      } else if (cmd === 'paste') {
        unwrap(window.turnflow.readClipboard()).then((c) => c?.text && term?.paste(c.text))
      } else if ('tab' in cmd) act({ t: 'focusTab', n: cmd.tab })
      else if ('panel' in cmd) act({ t: 'focusPanel', dir: cmd.panel })
      else act({ t: 'cycleTab', dir: cmd.cycle })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [activeId, layout, act, focusActive, toggleDraft, sb.folded])

  return (
    <div className="app" data-testid="app-shell">
      <Sidebar
        tasks={tasks}
        openIds={openIds}
        live={live}
        onOpen={(id) => act({ t: 'open', taskId: id })}
        onPeek={(id) => act({ t: 'peek', taskId: id })}
        onEnd={endSession}
        onSearch={() => setSearching(true)}
        root={root}
        folded={sb.folded}
        width={sb.width}
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
            <button data-nav title="Buscar task (Ctrl+Shift+K)" onClick={() => setSearching(true)}>
              <Icon name="search" />
            </button>
          </>
        }
      />
      <Panels
        layout={layout}
        byId={byId}
        live={live}
        act={act}
        onStarted={markStarted}
        onEnd={endSession}
        draft={!!cfg?.config.draftMode}
        newTabPanel={newTabPanel}
        setNewTabPanel={setNewTabPanel}
        onNewTab={newTab}
        cfg={cfg}
        setCfg={setCfg}
      />
      {searching && (
        <Search
          tasks={tasks}
          onPick={(id) => {
            setSearching(false)
            act({ t: 'open', taskId: id })
          }}
          onClose={() => {
            setSearching(false)
            focusActive()
          }}
        />
      )}
    </div>
  )
}

export default App
