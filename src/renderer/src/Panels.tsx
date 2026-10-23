import { useState, type ReactNode } from 'react'
import type { ConfigState, Task } from '../../shared/types'
import { SettingsView } from './SettingsView'
import type { Live } from './App'
import { type Action, type Layout, scratchKind, HOME, SETTINGS, tabLabel } from './layout'
import { Dot } from './Dot'
import { Icon } from './Icon'
import { ScratchView } from './ScratchView'
import { TaskView } from './TaskView'
import { dragSizes } from './resize'

type Props = {
  layout: Layout
  byId: Map<string, Task>
  live: Live
  act(a: Action): void
  onStarted(id: string): void
  onEnd(id: string): void
  draft: boolean
  newTabPanel: number | null // painel com o menu "+" aberto
  setNewTabPanel(p: number | null): void
  onNewTab(kind: 'claude' | 'shell' | 'task', panel: number): void
  cfg: ConfigState | null
  setCfg(s: ConfigState): void
  home: ReactNode
}

const DRAG = 'text/dk-task'
type Zone = { panel: number; side: -1 | 0 | 1 } // -1/1 = borda (divide), 0 = meio (move pra cá)

// Faixa de 30% em cada borda divide a tela; o meio só move a aba pro painel.
function zoneOf(e: React.DragEvent<HTMLElement>, panel: number): Zone {
  // em cima da barra de abas é sempre "mover pra cá" (gesto natural de mover)
  if ((e.target as HTMLElement).closest('.tabbar')) return { panel, side: 0 }
  const r = e.currentTarget.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width
  return { panel, side: x < 0.3 ? -1 : x > 0.7 ? 1 : 0 }
}

function NewTabMenu({
  onPick,
  onClose
}: {
  onPick(k: 'claude' | 'shell' | 'task'): void
  onClose(): void
}): React.JSX.Element {
  const items: [
    k: 'claude' | 'shell' | 'task',
    icon: 'pencil' | 'terminal' | 'search',
    label: string
  ][] = [
    ['claude', 'pencil', 'Sessão vazia com Claude'],
    ['shell', 'terminal', 'Terminal'],
    ['task', 'search', 'Escolher task…']
  ]
  return (
    <ul
      className="menu newtab"
      role="menu"
      onMouseLeave={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        const bs = [...e.currentTarget.querySelectorAll('button')]
        const i = bs.indexOf(document.activeElement as HTMLButtonElement)
        bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus()
        e.preventDefault()
      }}
    >
      {items.map(([k, icon, label], i) => (
        <li key={k}>
          <button role="menuitem" autoFocus={i === 0} onClick={() => onPick(k)}>
            <Icon name={icon} size={13} /> {label}
          </button>
        </li>
      ))}
    </ul>
  )
}

export function Panels(props: Props): React.JSX.Element {
  const {
    layout,
    byId,
    live,
    act,
    onStarted,
    onEnd,
    draft,
    newTabPanel,
    setNewTabPanel,
    onNewTab,
    cfg,
    setCfg,
    home
  } = props
  const [zone, setZone] = useState<Zone | null>(null)

  // Arraste da divisória entre o painel i e o i+1: pesos novos a cada movimento do mouse.
  const startDrag = (e: React.MouseEvent, i: number): void => {
    e.preventDefault()
    const els = [...document.querySelectorAll<HTMLElement>('.panels > .panel')]
    const wa = els[i]?.getBoundingClientRect().width ?? 0
    const wb = els[i + 1]?.getBoundingClientRect().width ?? 0
    const a = layout.panels[i]?.size ?? 1
    const b = layout.panels[i + 1]?.size ?? 1
    const x0 = e.clientX
    document.body.classList.add('resizing')
    const move = (ev: MouseEvent): void => {
      const [na, nb] = dragSizes(a, b, wa, wb, ev.clientX - x0)
      act({ t: 'resizePair', panel: i, a: na, b: nb })
    }
    const up = (): void => {
      document.body.classList.remove('resizing')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const plus = (pi: number): React.JSX.Element => (
    <span className="menu-wrap">
      <button
        className="tab-plus"
        title="Nova aba (Ctrl+Shift+T)"
        onClick={(e) => {
          e.stopPropagation()
          setNewTabPanel(newTabPanel === pi ? null : pi)
        }}
      >
        <Icon name="plus" size={14} />
      </button>
      {newTabPanel === pi && (
        <NewTabMenu
          onClose={() => setNewTabPanel(null)}
          onPick={(k) => {
            setNewTabPanel(null)
            onNewTab(k, pi)
          }}
        />
      )}
    </span>
  )

  if (!layout.panels.length)
    return (
      <main className="panels empty-all">
        {home}
        <div className="empty-start">
          <div className="empty-actions">
            <button onClick={() => onNewTab('task', 0)}>
              <Icon name="search" size={14} /> Escolher task <kbd>Ctrl+Shift+K</kbd>
            </button>
            <button onClick={() => onNewTab('claude', 0)}>
              <Icon name="pencil" size={14} /> Claude sem task
            </button>
            <button onClick={() => onNewTab('shell', 0)}>
              <Icon name="terminal" size={14} /> Terminal
            </button>
          </div>
        </div>
      </main>
    )

  return (
    <main className="panels" onDragEnd={() => setZone(null)}>
      {layout.panels.map((p, pi) => {
        const divider =
          pi > 0 ? (
            <div
              key={`d${pi}`}
              className="divider"
              title="Arraste pra redimensionar · clique duplo iguala"
              onMouseDown={(e) => startDrag(e, pi - 1)}
              onDoubleClick={() => act({ t: 'equalize' })}
            />
          ) : null
        const focused = pi === layout.focused
        const activeId = p.tabs[p.active]
        const task = activeId ? byId.get(activeId) : undefined
        const z = zone?.panel === pi ? zone : null
        return [
          divider,
          <section
            key={pi}
            style={{ flex: `${p.size ?? 1} 1 0` }}
            className={`panel ${focused ? 'focused' : ''}`}
            onMouseDown={() => act({ t: 'focusAt', panel: pi })}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG)) return
              e.preventDefault()
              const nz = zoneOf(e, pi)
              if (nz.panel !== zone?.panel || nz.side !== zone?.side) setZone(nz)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null)
            }}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(DRAG)
              if (!id) return
              e.preventDefault()
              const nz = zoneOf(e, pi)
              setZone(null)
              act(
                nz.side === 0
                  ? { t: 'move', taskId: id, toPanel: pi }
                  : { t: 'splitMove', taskId: id, panel: pi, side: nz.side }
              )
            }}
          >
            {z && (
              <div
                className={`dropzone ${z.side === -1 ? 'left' : z.side === 1 ? 'right' : 'center'}`}
              />
            )}
            <div className="tabbar">
              {p.tabs.map((id, ti) => {
                const scratch = scratchKind(id)
                return (
                  <div
                    key={id}
                    role="tab"
                    tabIndex={-1}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG, id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    className={`tab ${ti === p.active ? 'active' : ''} ${p.preview === id ? 'preview' : ''}`}
                    onDoubleClick={() => act({ t: 'pin', taskId: id })}
                    onClick={() => act({ t: 'open', taskId: id })}
                    onAuxClick={(e) => e.button === 1 && act({ t: 'close', taskId: id })}
                    title={byId.get(id)?.title ?? tabLabel(id)}
                  >
                    {id === SETTINGS ? (
                      <Icon name="settings" size={12} />
                    ) : scratch ? (
                      <Icon name={scratch === 'claude' ? 'pencil' : 'terminal'} size={12} />
                    ) : (
                      <Dot state={live.alive.has(id) ? live.states[id] : undefined} />
                    )}
                    <span className="tab-label">
                      {scratch || id === SETTINGS
                        ? tabLabel(id)
                        : `${id} ${byId.get(id)?.title ?? ''}`}
                    </span>
                    <button
                      className="tab-x"
                      title={
                        scratch
                          ? 'Fechar aba (encerra o processo)'
                          : 'Fechar aba (a sessão continua)'
                      }
                      onClick={(e) => {
                        e.stopPropagation()
                        if (scratch) onEnd(id) // aba avulsa não tem lista onde voltar: fechar encerra
                        act({ t: 'close', taskId: id })
                      }}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                )
              })}
              {plus(pi)}
              {!p.tabs.length && (
                <button
                  className="tab-x"
                  title="Fechar painel"
                  onClick={() => act({ t: 'dropPanel', panel: pi })}
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
            {activeId === HOME ? (
              home
            ) : activeId === SETTINGS ? (
              cfg && <SettingsView cfg={cfg} onChange={setCfg} />
            ) : activeId && scratchKind(activeId) ? (
              <ScratchView
                key={activeId}
                id={activeId}
                live={live}
                focused={focused}
                draft={draft}
                workdir={cfg?.config.defaultWorkdir ?? null}
                onStarted={onStarted}
                onEnd={onEnd}
              />
            ) : task ? (
              <TaskView
                key={task.id}
                task={task}
                live={live}
                focused={focused}
                draft={draft}
                onStarted={onStarted}
                onEnd={onEnd}
                onPin={() => act({ t: 'pin', taskId: task.id })}
              />
            ) : activeId ? (
              <div className="notice">{activeId} não existe mais no brain.</div>
            ) : (
              <div className="notice">
                Painel vazio. Use o <b>+</b> acima, <kbd>Ctrl+Shift+K</kbd> ou clique numa task na
                lista.
              </div>
            )}
          </section>
        ]
      })}
    </main>
  )
}
