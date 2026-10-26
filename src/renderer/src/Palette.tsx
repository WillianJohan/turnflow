import { useEffect, useId, useRef, useState } from 'react'
import { SHELL_COPY } from '../../shared/copy/shell'
import type { SearchHit } from '../../shared/ipc/search'
import { COMMANDS, type CommandDef } from './commands'
import { cycleType, mergeFound, paletteItems, type Found, type PaletteItem } from './palette'

const T = SHELL_COPY.palette
const SEARCH_DELAY = 120

type Props = {
  /** `search`: achar primeiro. `new` (+ Novo > Task): criar primeiro. */
  mode: 'search' | 'new'
  /** Tasks do brain legado: entram por subsequência, atrás das do domínio. */
  brain: { id: string; title: string }[]
  /** O que aparece com a busca vazia (a fila de atenção). */
  recent?: Found[]
  /** Busca FTS do domínio (inclui concluídas). */
  search(q: string): Promise<SearchHit[]>
  types: { id: string; name: string }[]
  projects: { id: string; name: string }[]
  commands?: CommandDef[]
  onPickTask(id: string): void
  /** Devolve a mensagem de erro, ou `null` quando criou (quem chama fecha a paleta). */
  onCreate(item: {
    title: string
    typeId: string
    projectId: string | null
  }): Promise<string | null>
  onCommand(id: string): void
  onClose(): void
}

export function Palette({
  mode,
  brain,
  recent = [],
  search,
  types,
  projects,
  commands = COMMANDS,
  onPickTask,
  onCreate,
  onCommand,
  onClose
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [typeId, setTypeId] = useState<string | undefined>(undefined)
  const [sel, setSel] = useState(0)
  const [hits, setHits] = useState<{ q: string; rows: SearchHit[] }>({ q: '', rows: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const creating = useRef(false)
  // Enter com a busca desta consulta ainda no ar: espera o resultado antes de decidir (senão o
  // único item é o Create e nasce uma task duplicada)
  const [waiting, setWaiting] = useState(false)
  const seq = useRef(0)
  const listId = useId()

  const q = query.trim()
  useEffect(() => {
    if (!q || q.startsWith('>')) return
    const mine = ++seq.current
    const timer = setTimeout(() => {
      void search(q).then(
        (rows) => mine === seq.current && setHits({ q, rows }),
        () => mine === seq.current && setHits({ q, rows: [] })
      )
    }, SEARCH_DELAY)
    return () => clearTimeout(timer)
  }, [q, search])

  const found = q ? mergeFound(hits.q === q ? hits.rows : [], brain, q) : recent
  const items = paletteItems({ query, found, types, projects, commands, typeId, mode })
  const at = Math.min(sel, Math.max(items.length - 1, 0))
  const current = items[at]
  const optionId = (i: number): string => `${listId}-${i}`

  const searchPending = q !== '' && !q.startsWith('>') && hits.q !== q
  const run = (item: PaletteItem | undefined): void => {
    if (!item) return
    if (item.kind === 'task') onPickTask(item.id)
    else if (item.kind === 'command') onCommand(item.id)
    else {
      // um Enter por vez: o segundo, com a criação no ar, não cria outra task
      if (creating.current) return
      creating.current = true
      setBusy(true)
      setError('')
      void onCreate(item)
        .then(
          (message) => message && setError(message),
          (e: unknown) => setError(e instanceof Error ? e.message : String(e))
        )
        .finally(() => {
          creating.current = false
          setBusy(false)
        })
    }
  }

  useEffect(() => {
    if (!waiting || searchPending) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consome o Enter guardado
    setWaiting(false)
    run(items[at])
    // roda quando a busca da consulta atual chega; `run`/`items` são os desse render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, searchPending])

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="search"
        role="dialog"
        aria-label={T.label}
        aria-busy={busy}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          role="combobox"
          aria-label={T.label}
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current ? optionId(at) : undefined}
          placeholder={T.placeholder}
          onChange={(event) => {
            setQuery(event.target.value)
            setTypeId(undefined)
            setSel(0)
            setError('')
            setWaiting(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
            else if (event.key === 'ArrowDown') setSel(Math.min(at + 1, items.length - 1))
            else if (event.key === 'ArrowUp') setSel(Math.max(at - 1, 0))
            else if (event.key === 'Tab' && current?.kind === 'create') {
              const next = cycleType(types, current.typeId)
              if (next) setTypeId(next)
            } else if (event.key === 'Enter') {
              if (searchPending && mode === 'search') setWaiting(true)
              else run(current)
            } else return
            event.preventDefault()
          }}
        />
        {error && (
          <p className="palette-error" role="alert">
            {error}
          </p>
        )}
        <ul id={listId} role="listbox" aria-label={T.results}>
          {items.map((item, index) => (
            <li
              key={item.kind === 'create' ? 'create' : `${item.kind}:${item.id}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === at}
              aria-disabled={item.kind === 'create' && busy ? true : undefined}
              className={index === at ? 'sel' : ''}
              // mouseMove, não mouseEnter: a lista nasce embaixo do ponteiro parado e roubaria a seleção
              onMouseMove={() => index !== at && setSel(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(item)}
            >
              {item.kind === 'create' && (
                <>
                  <span>{busy ? T.creating : T.create}</span> {item.title}{' '}
                  <span className="palette-chip">{item.typeName}</span>{' '}
                  <span className="palette-chip">{item.projectName ?? T.noProject}</span>
                </>
              )}
              {item.kind === 'task' && (
                <>
                  <span className="palette-key">{item.key}</span> {item.title}
                  {item.done && <span className="palette-chip">{T.done}</span>}
                </>
              )}
              {item.kind === 'command' && item.label}
            </li>
          ))}
          {!items.length && (
            <li className="empty" role="presentation">
              {T.empty}
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
