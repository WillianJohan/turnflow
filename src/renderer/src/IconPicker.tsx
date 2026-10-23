import { useEffect, useRef, useState } from 'react'
import { EMOJIS, ICON_WORDS } from './emojiSet'
import { ICONS } from './iconSet'
import { formatIcon, parseIcon } from './statusIcon'

// Cores do seletor de ícones do Notion; null = acompanha a cor do texto do tema.
const COLORS: [string | null, string][] = [
  [null, 'Cor do texto'],
  ['#91918e', 'Cinza'],
  ['#a27763', 'Marrom'],
  ['#cb7b37', 'Laranja'],
  ['#c29243', 'Amarelo'],
  ['#4f9768', 'Verde'],
  ['#2e7cd1', 'Azul'],
  ['#8d5bc1', 'Roxo'],
  ['#c94a8c', 'Rosa'],
  ['#cd5049', 'Vermelho']
]
const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

type Props = { value: string; onPick(v: string): void; onClose(): void }

export function IconPicker({ value, onPick, onClose }: Props): React.JSX.Element {
  const cur = parseIcon(value)
  const [tab, setTab] = useState<'emoji' | 'icon'>(cur.kind === 'icon' ? 'icon' : 'emoji')
  const [q, setQ] = useState('')
  const [color, setColor] = useState<string | null>(cur.kind === 'icon' ? cur.color : null)
  const ref = useRef<HTMLDivElement>(null)
  const [up, setUp] = useState(false)

  // sem espaço embaixo: abre pra cima
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- medida do DOM depois de montar
    if (r && r.bottom > window.innerHeight - 8) setUp(true)
  }, [])

  // clique fora fecha
  useEffect(() => {
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const nq = norm(q.trim())
  const emojis = EMOJIS.filter(([e, k]) => !nq || norm(k).includes(nq) || e === q.trim())
  const icons = Object.keys(ICONS).filter(
    (n) => !nq || n.includes(nq) || norm(ICON_WORDS[n] ?? '').includes(nq)
  )

  return (
    <div
      className={`icon-picker ${up ? 'up' : ''}`}
      ref={ref}
      role="dialog"
      aria-label="Escolher ícone"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="ip-tabs">
        <button className={tab === 'emoji' ? 'on' : ''} onClick={() => setTab('emoji')}>
          Emoji
        </button>
        <button className={tab === 'icon' ? 'on' : ''} onClick={() => setTab('icon')}>
          Ícones
        </button>
        <button className="ip-remove" onClick={() => onPick('')}>
          Remover
        </button>
      </div>
      <input
        autoFocus
        className="ip-search"
        placeholder="Buscar…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {tab === 'icon' && (
        <div className="ip-colors">
          {COLORS.map(([c, label]) => (
            <button
              key={label}
              title={label}
              className={`ip-swatch ${color === c ? 'on' : ''} ${c ? '' : 'auto'}`}
              style={c ? { background: c } : undefined}
              onClick={() => setColor(c)}
            />
          ))}
          <label className="ip-swatch custom" title="Outra cor">
            <input
              type="color"
              value={color ?? '#888888'}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
        </div>
      )}
      <div className="ip-grid">
        {tab === 'emoji'
          ? emojis.map(([e, k]) => (
              <button
                key={e}
                title={k}
                className={cur.kind === 'emoji' && cur.value === e ? 'on' : ''}
                onClick={() => onPick(e)}
              >
                {e}
              </button>
            ))
          : icons.map((n) => {
              const C = ICONS[n]
              return (
                <button
                  key={n}
                  title={n}
                  className={cur.kind === 'icon' && cur.name === n ? 'on' : ''}
                  onClick={() => onPick(formatIcon({ kind: 'icon', name: n, color }))}
                >
                  <C size={18} color={color ?? 'currentColor'} strokeWidth={2.2} />
                </button>
              )
            })}
        {(tab === 'emoji' ? emojis : icons).length === 0 && <p className="dim">nada encontrado</p>}
      </div>
    </div>
  )
}
