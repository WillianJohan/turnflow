import { useEffect, useState } from 'react'
import type { ConfigState, Theme } from '../../shared/types'
import { applyTheme } from './theme'
import { slug } from './slug'

const UI_LABELS: [key: string, label: string][] = [
  ['bg', 'Fundo'],
  ['bg2', 'Fundo da lista e das abas'],
  ['bg3', 'Fundo de menus'],
  ['headerBg', 'Cabeçalho da task'],
  ['line', 'Linhas e bordas'],
  ['fg', 'Texto'],
  ['fgDim', 'Texto secundário'],
  ['accent', 'Destaque (botões, foco, cursor)'],
  ['primaryFg', 'Texto no botão de destaque'],
  ['selBg', 'Seleção (lista, menus, texto)'],
  ['yellow', 'Bolinha: esperando você'],
  ['green', 'Bolinha: trabalhando'],
  ['gray', 'Bolinha: parado'],
  ['red', 'Erro / encerrar'],
  ['warnBg', 'Aviso (fundo)'],
  ['errBg', 'Erro (fundo)'],
  ['errFg', 'Erro (texto)']
]
const TERM_LABELS: [string, string][] = [
  ['background', 'Fundo'],
  ['foreground', 'Texto'],
  ['cursor', 'Cursor'],
  ['selectionBackground', 'Seleção']
]
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const ANSI_LABELS: [string, string][] = [
  ...ANSI.map((c): [string, string] => [c, c]),
  ...ANSI.map((c): [string, string] => [`bright${c[0].toUpperCase()}${c.slice(1)}`, `${c} claro`])
]

function ColorRow(props: {
  label: string
  value: string | undefined
  onChange(v: string): void
}): React.JSX.Element {
  const v = props.value ?? ''
  return (
    <label className="color-row">
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <input
        className="hex"
        value={v}
        placeholder="padrão"
        onChange={(e) => props.onChange(e.target.value.trim())}
        spellCheck={false}
      />
      <span>{props.label}</span>
    </label>
  )
}

// Edita uma cópia do tema escolhido; a tela já mostra o resultado enquanto você mexe.
export function ThemeEditor({
  cfg,
  onChange
}: {
  cfg: ConfigState
  onChange(s: ConfigState): void
}): React.JSX.Element {
  const current = cfg.themes.find((t) => t.id === cfg.config.theme)
  const [draft, setDraft] = useState<Theme>(cfg.theme)
  const [name, setName] = useState(current?.builtin ? `${cfg.theme.name} (meu)` : cfg.theme.name)
  const [dirty, setDirty] = useState(false)
  const [err, setErr] = useState('')

  // trocou o tema ativo: recomeça a edição a partir dele
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recomeça a edição quando o tema ativo troca
    setDraft(cfg.theme)
    setName(current?.builtin ? `${cfg.theme.name} (meu)` : cfg.theme.name)
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o tema ativo muda
  }, [cfg.config.theme])

  // pré-visualização ao vivo; sair sem salvar volta pro tema ativo
  useEffect(() => {
    if (dirty) applyTheme(draft, cfg.config)
  }, [draft, dirty, cfg.config])
  useEffect(() => () => applyTheme(cfg.theme, cfg.config), [cfg.theme, cfg.config])

  const set = (part: 'ui' | 'terminal', key: string, v: string): void => {
    setDraft((d) => ({ ...d, [part]: { ...d[part], [key]: v } }))
    setDirty(true)
  }

  const saveAs = (id: string): void => {
    setErr('')
    const clean = (o: Record<string, string>): Record<string, string> =>
      Object.fromEntries(Object.entries(o).filter(([, v]) => v))
    window.dk
      .saveTheme(id, {
        name: name.trim() || id,
        ui: clean(draft.ui),
        terminal: clean(draft.terminal)
      })
      .then(
        (s) => {
          setDirty(false)
          onChange(s)
        },
        (e) => setErr(String(e?.message ?? e).replace(/^Error invoking[^:]+: (Error: )?/, ''))
      )
  }

  const newId = slug(name)
  const canOverwrite = current && !current.builtin
  return (
    <div className="theme-editor">
      <div className="te-head">
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="te-actions">
          {canOverwrite && (
            <button className="primary" disabled={!dirty} onClick={() => saveAs(cfg.config.theme)}>
              Salvar
            </button>
          )}
          <button
            className={canOverwrite ? '' : 'primary'}
            disabled={!newId || newId === cfg.config.theme}
            onClick={() => saveAs(newId)}
            title={`Grava themes/${newId}.json e ativa`}
          >
            Salvar como novo
          </button>
          <button
            disabled={!dirty}
            onClick={() => {
              setDraft(cfg.theme)
              setDirty(false)
              applyTheme(cfg.theme, cfg.config)
            }}
          >
            Descartar
          </button>
          {canOverwrite && (
            <button
              className="danger"
              onClick={() => window.dk.deleteTheme(cfg.config.theme).then(onChange)}
            >
              Excluir tema
            </button>
          )}
        </div>
      </div>
      {current?.builtin && (
        <p className="dim">Tema padrão: suas mudanças viram um tema novo ao salvar.</p>
      )}
      {err && <p className="err">{err}</p>}
      <div className="te-cols">
        <section>
          <h4>Interface</h4>
          {UI_LABELS.map(([k, l]) => (
            <ColorRow key={k} label={l} value={draft.ui[k]} onChange={(v) => set('ui', k, v)} />
          ))}
        </section>
        <section>
          <h4>Terminal</h4>
          {TERM_LABELS.map(([k, l]) => (
            <ColorRow
              key={k}
              label={l}
              value={draft.terminal[k]}
              onChange={(v) => set('terminal', k, v)}
            />
          ))}
          <details>
            <summary>16 cores ANSI</summary>
            {ANSI_LABELS.map(([k, l]) => (
              <ColorRow
                key={k}
                label={l}
                value={draft.terminal[k]}
                onChange={(v) => set('terminal', k, v)}
              />
            ))}
          </details>
        </section>
      </div>
    </div>
  )
}
