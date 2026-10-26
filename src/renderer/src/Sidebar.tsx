import { CSSProperties, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { SHELL_COPY } from '../../shared/copy/shell'
import type { TaskRow } from '../../shared/contracts'
import { clampSidebar, SIDEBAR_DEFAULT, type Density } from '../../shared/uiFile'
import type { Task } from '../../shared/types'
import { AttentionList } from './AttentionList'
import type { Live } from './App'
import { Dot } from './ui/Dot'
import { kidCount, tree, visibleRows } from './tree'
import { Icon } from './Icon'
import { Logo } from './Logo'
import { StatusIcon } from './StatusIcon'
import { parseIcon } from './statusIcon'

type Props = {
  tasks: Task[]
  openIds: Set<string>
  live: Live
  onOpen(id: string): void
  onPeek(id: string): void
  onEnd(id: string): void
  onSearch?(): void
  actions?: ReactNode
  root?: string
  folded?: boolean // lista recolhida (faixa só com ícones)
  width?: number
  onToggle?(): void
  onWidth?(w: number): void
  icons?: Record<string, string>
  attention?: TaskRow[]
  density?: Density
  onDensity?(density: Density): void
  /** Keys de tasks que já existem no domínio: a árvore do brain não repete as importadas. */
  domainKeys?: Set<string>
}

// nomes de bucket do brain do usuário (dado, não texto da UI): começam recolhidos
const COLLAPSED = new Set(['Concluído', 'Arquivada'])
const FILTER_KEY = 'turnflow.sidebarFilter'

const S = SHELL_COPY.sidebar

function loadFilter(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FILTER_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

// cor do grupo = cor do ícone configurado; sem cor, o cinza do tema
const groupStyle = (icon?: string): CSSProperties => {
  const v = parseIcon(icon ?? '')
  return { '--gc': v.kind === 'icon' && v.color ? v.color : 'var(--fg-dim)' } as CSSProperties
}

// setas sobem/descem entre itens focáveis da sidebar
function onKeyNav(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')]
  const i = items.indexOf(document.activeElement as HTMLElement)
  items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  e.preventDefault()
}

export function Sidebar({
  icons = {},
  tasks,
  openIds,
  live,
  onOpen,
  onPeek,
  onEnd,
  onSearch,
  actions,
  root,
  folded,
  width = SIDEBAR_DEFAULT,
  onToggle,
  onWidth,
  attention = [],
  density = 'normal',
  onDensity,
  domainKeys
}: Props): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(COLLAPSED)
  const [expanded, setExpanded] = useState<Set<string>>(new Set()) // épicos abertos
  const [filter, setFilter] = useState<Set<string>>(loadFilter) // vazio = todas
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify([...filter]))
    } catch {
      /* sem storage o filtro só não sobrevive ao restart */
    }
  }, [filter])

  // popup do filtro fecha ao clicar fora ou a janela perder o foco
  useEffect(() => {
    if (!filterOpen) return
    const down = (e: MouseEvent): void => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false)
    }
    const blur = (): void => setFilterOpen(false)
    document.addEventListener('mousedown', down, true)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('mousedown', down, true)
      window.removeEventListener('blur', blur)
    }
  }, [filterOpen])
  const byNum = (a: Task, b: Task): number =>
    Number(b.id.replace(/\D/g, '')) - Number(a.id.replace(/\D/g, ''))
  const open = tasks.filter((t) => openIds.has(t.id) || live.alive.has(t.id)).sort(byNum)
  const imported = useMemo(
    () => new Set([...(domainKeys ?? []), ...attention.map((row) => row.key)]),
    [domainKeys, attention]
  )
  const groups = useMemo(() => {
    const m = new Map<number, { name: string; tasks: Task[] }>()
    for (const t of tasks) {
      if (imported.has(t.id)) continue
      const g = m.get(t.bucket.idx) ?? { name: t.bucket.name, tasks: [] }
      g.tasks.push(t)
      m.set(t.bucket.idx, g)
    }
    return [...m.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, g]) => {
        const rows = tree(g.tasks.sort(byNum))
        return { ...g, rows, kids: kidCount(rows) }
      })
  }, [tasks, imported])
  const shown = filter.size ? groups.filter((g) => filter.has(g.name)) : groups

  const flip =
    (set: (f: (s: Set<string>) => Set<string>) => void) =>
    (key: string): void =>
      set((c) => {
        const n = new Set(c)
        if (n.has(key)) n.delete(key)
        else n.add(key)
        return n
      })
  const toggle = flip(setCollapsed)
  const toggleKids = flip(setExpanded)
  const toggleFilter = flip(setFilter)

  const closeFilter = (): void => {
    setFilterOpen(false)
    filterRef.current?.querySelector<HTMLElement>('.filter-btn')?.focus()
  }

  const item = (t: Task, depth: number, kids: number): React.JSX.Element => {
    const isExp = expanded.has(t.id)
    return (
      <div
        className={`item-row ${depth ? 'child' : ''}`}
        key={t.id}
        style={{ marginLeft: depth ? 30 + (depth - 1) * 16 : 0 }}
      >
        <button
          data-nav
          className={`item ${openIds.has(t.id) ? 'is-open' : ''}`}
          onClick={() => onPeek(t.id)}
          onDoubleClick={() => onOpen(t.id)}
          title={`${t.id} — ${t.title}\n${t.status}`}
        >
          <span className="item-title">{t.title}</span>
          <span className="item-meta">
            {live.alive.has(t.id) && <Dot state={live.states[t.id]} />}
            <span className="item-id">{t.id}</span>
          </span>
        </button>
        {kids > 0 && (
          <button
            data-nav
            className={`item-kids ${isExp ? 'on' : ''}`}
            aria-expanded={isExp}
            title={S.kids(isExp, kids)}
            onClick={() => toggleKids(t.id)}
          >
            {kids}
            <Icon name="chevron" size={13} />
          </button>
        )}
      </div>
    )
  }

  // aberta: cartão com estado do claude e botão de encerrar
  const card = (t: Task): React.JSX.Element => {
    const alive = live.alive.has(t.id)
    const state = alive ? (live.states[t.id] ?? 'idle') : undefined
    return (
      <div
        className={`open-card ${state ?? 'closed'}`}
        key={t.id}
        style={groupStyle(icons[t.bucket.name])}
      >
        <button
          data-nav
          className={`open-main ${openIds.has(t.id) ? 'is-open' : ''}`}
          onClick={() => onOpen(t.id)}
          title={`${t.id} — ${t.title}\n${t.status}`}
        >
          <span className="item-title">{t.title}</span>
          <span className="item-meta">
            <Dot state={state} />
            <span className="item-id">{t.id}</span>
            <span>· {state ? S.states[state] : S.noSession}</span>
          </span>
        </button>
        {alive && (
          <button data-nav className="item-end" title={S.endSession} onClick={() => onEnd(t.id)}>
            <Icon name="power" size={15} />
          </button>
        )}
      </div>
    )
  }

  const foldBtn = (
    <button data-nav className="sb-toggle" title={S.toggle(!!folded)} onClick={onToggle}>
      <Icon name="sidebar" />
    </button>
  )

  // recolhida: faixa fina com os ícones e as bolinhas das abertas
  if (folded)
    return (
      <nav className="sidebar rail" id="sidebar" onKeyDown={onKeyNav}>
        {foldBtn}
        <span className="rail-actions">{actions}</span>
        <div className="rail-open">
          {attention
            .filter((row) => row.group === 'sua_vez')
            .map((row) => (
              <button
                key={row.id}
                data-nav
                title={`${row.key} — ${row.title}`}
                onClick={() => onOpen(row.id)}
              >
                <Dot state={row.session?.state} />
              </button>
            ))}
          {open.map((t) => (
            <button key={t.id} data-nav title={`${t.id} — ${t.title}`} onClick={() => onOpen(t.id)}>
              <Dot state={live.alive.has(t.id) ? live.states[t.id] : undefined} />
            </button>
          ))}
        </div>
      </nav>
    )

  // arrastar a borda direita muda a largura
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const x0 = e.clientX
    document.body.classList.add('resizing')
    const move = (ev: MouseEvent): void => onWidth?.(clampSidebar(width + ev.clientX - x0))
    const up = (): void => {
      document.body.classList.remove('resizing')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <nav className="sidebar" id="sidebar" onKeyDown={onKeyNav} style={{ width }}>
      <div
        className="sb-resize"
        onMouseDown={startResize}
        onDoubleClick={() => onWidth?.(SIDEBAR_DEFAULT)}
        title={S.resize}
      />
      <div className="sb-head">
        <Logo />
        <span className="sb-actions">
          {actions}
          {foldBtn}
        </span>
      </div>
      <div className="sb-tools">
        <button data-nav className="sb-find" onClick={onSearch} title={S.search}>
          <Icon name="search" size={14} />
          <span>{S.searchLabel}</span>
        </button>
        <div
          className="filter"
          ref={filterRef}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && filterOpen) {
              e.stopPropagation()
              closeFilter()
            }
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setFilterOpen(false)
          }}
        >
          <button
            data-nav
            className={`filter-btn ${filter.size || filterOpen ? 'on' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
            aria-label={S.filter}
            title={S.filter}
            onClick={() => setFilterOpen((o) => !o)}
          >
            <Icon name="filter" size={14} />
            {filter.size > 0 && <span className="filter-badge">{filter.size}</span>}
          </button>
          {filterOpen && (
            <div
              className="filter-pop"
              role="dialog"
              aria-label={S.filter}
              tabIndex={-1}
              onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}
            >
              <div className="filter-head">
                {S.filterHead}
                <button onClick={() => setFilter(new Set())}>{S.filterAll}</button>
              </div>
              {groups.map((g, i) => (
                <label className="filter-opt" key={g.name} style={groupStyle(icons[g.name])}>
                  <input
                    type="checkbox"
                    autoFocus={i === 0}
                    checked={filter.has(g.name)}
                    onChange={() => toggleFilter(g.name)}
                  />
                  <span className="filter-swatch" />
                  <span className="filter-name">{g.name}</span>
                  <span className="count">{g.tasks.length}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      {filter.size > 0 && (
        <div className="filter-chips">
          {[...filter].map((name) => (
            <button
              key={name}
              className="chip"
              style={groupStyle(icons[name])}
              aria-label={S.removeFilter(name)}
              onClick={() => toggleFilter(name)}
            >
              {name}
              <Icon name="x" size={11} />
            </button>
          ))}
        </div>
      )}
      <div className="sb-scroll">
        <div className="attn-switch" role="group" aria-label={S.density}>
          {(
            [
              ['compact', S.densities.compact],
              ['normal', S.densities.normal],
              ['wide', S.densities.wide]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={density === id}
              onClick={() => onDensity?.(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <AttentionList rows={attention} density={density} onOpen={onOpen} onPeek={onPeek} />
        {!tasks.length && <p className="sb-empty">{root ? S.noTasksIn(root) : S.noBrain}</p>}
        {open.length > 0 && (
          <section className="open-list">
            <h5 className="open-head">
              {S.open} <span className="count">{open.length}</span>
            </h5>
            {open.map(card)}
          </section>
        )}
        {tasks.length > 0 && !shown.length && <p className="sb-empty">{S.noneFiltered}</p>}
        {shown.map((g) => {
          const isOpen = !collapsed.has(g.name)
          return (
            <section key={g.name} style={groupStyle(icons[g.name])}>
              <h5>
                <button
                  data-nav
                  className="group"
                  aria-expanded={isOpen}
                  onClick={() => toggle(g.name)}
                >
                  <span className="group-icon">
                    {icons[g.name] ? <StatusIcon value={icons[g.name]} size={14} /> : null}
                  </span>
                  <span className="group-name">{g.name}</span>
                  <span className="count">{g.tasks.length}</span>
                  <span className={`group-chev ${isOpen ? '' : 'shut'}`}>
                    <Icon name="chevron" size={15} />
                  </span>
                </button>
              </h5>
              {isOpen &&
                visibleRows(g.rows, expanded).map((r) =>
                  item(r.task, r.depth, g.kids.get(r.task.id) ?? 0)
                )}
            </section>
          )
        })}
      </div>
    </nav>
  )
}
