import { useEffect, useState } from 'react'
import type { AppConfig, ConfigState } from '../../shared/types'
import { ThemeEditor } from './ThemeEditor'
import { IconPicker } from './IconPicker'
import { StatusIcon } from './StatusIcon'
import { orThrow, unwrap } from './ipc'
import { WipeAll } from './features/vault/WipeAll'
import { COPY as VAULT_SCREENS } from './features/vault/copy'
import { ImportBrain } from './features/import/ImportBrain'
import { ImportLegacy } from './features/import/ImportLegacy'
import { ExportMarkdown } from './features/import/ExportMarkdown'
import { IMPORT_COPY } from '../../shared/copy/import'

// Número que aceita digitação: "12" passa por "1", então só valida ao confirmar.
function SizeField({
  value,
  onCommit
}: {
  value: number
  onCommit(n: number): void
}): React.JSX.Element {
  const [v, setV] = useState(String(value))
  const commit = (raw: string): void => {
    const n = Number(raw)
    if (n >= 9 && n <= 24) onCommit(n)
    else setV(String(value))
  }
  return (
    <input
      type="number"
      min={9}
      max={24}
      value={v}
      onChange={(e) => {
        setV(e.target.value)
        // setinhas do campo mandam valor completo: aplica na hora
        if ((e.nativeEvent as InputEvent).inputType === undefined) commit(e.target.value)
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
    />
  )
}

function FontSelect(props: {
  value: string
  options: string[]
  fallback: string
  onChange(f: string): void
}): React.JSX.Element {
  const opts =
    props.options.includes(props.value) || props.value === props.fallback
      ? props.options
      : [props.value, ...props.options]
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      <option value={props.fallback}>Padrão</option>
      {opts.map((f) => (
        <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
          {f}
        </option>
      ))}
    </select>
  )
}

// Aba de Configurações: tudo num lugar só (tema + editor, fontes, rascunho, ícones, pasta).
export function SettingsView({
  cfg,
  onChange
}: {
  cfg: ConfigState
  onChange(s: ConfigState): void
}): React.JSX.Element {
  const [err, setErr] = useState('')
  const [picking, setPicking] = useState<string | null>(null)
  const [fonts, setFonts] = useState<{ all: string[]; mono: string[] }>({ all: [], mono: [] })
  useEffect(() => {
    unwrap(window.turnflow.fonts()).then((f) => f && setFonts(f))
  }, [])
  const set = (patch: Partial<Omit<AppConfig, 'agents'>>): void => {
    orThrow(window.turnflow.setConfig(patch)).then(onChange, (e) => setErr(String(e?.message ?? e)))
  }
  const c = cfg.config
  return (
    <div className="settings-page">
      <div className="sp-inner">
        <h2>Configurações</h2>
        {(err || cfg.error) && <p className="err">{err || cfg.error}</p>}

        <section className="sp-card">
          <h3>Tema</h3>
          <div className="theme-picker">
            {cfg.themes.map((t) => (
              <button
                key={t.id}
                className={`theme-chip ${t.id === c.theme ? 'on' : ''}`}
                onClick={() => set({ theme: t.id })}
                title={`themes/${t.id}.json`}
              >
                {t.name}
                {!t.builtin && <span className="dim"> · seu</span>}
              </button>
            ))}
          </div>
          <ThemeEditor cfg={cfg} onChange={onChange} />
        </section>

        <section className="sp-card">
          <h3>Fontes</h3>
          <div className="sp-grid">
            <label>
              Terminal
              <FontSelect
                value={c.termFont}
                options={fonts.mono}
                fallback="JetBrains Mono"
                onChange={(f) => set({ termFont: f })}
              />
            </label>
            <label>
              Tamanho
              <SizeField value={c.fontSize} onCommit={(n) => set({ fontSize: n })} />
            </label>
            <label>
              App
              <FontSelect
                value={c.appFont}
                options={fonts.all}
                fallback="system-ui"
                onChange={(f) => set({ appFont: f })}
              />
            </label>
            <label>
              Tamanho
              <SizeField value={c.appFontSize} onCommit={(n) => set({ appFontSize: n })} />
            </label>
          </div>
        </section>

        <section className="sp-card">
          <h3>Notificações</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={c.notifications}
              onChange={(e) => set({ notifications: e.target.checked })}
            />
            Avisar no sistema quando um Claude pedir permissão ou terminar e você não estiver
            olhando aquela aba
          </label>
        </section>

        <section className="sp-card">
          <h3>Rascunho</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={c.draftMode}
              onChange={(e) => set({ draftMode: e.target.checked })}
            />
            Draft mode: caixa de rascunho embaixo do terminal (Enter quebra linha, Ctrl+Enter envia)
            · <kbd>Ctrl+Shift+D</kbd>
          </label>
        </section>

        <section className="sp-card">
          <h3>Ícones dos status</h3>
          <div className="icon-grid">
            {Object.entries(c.statusIcons).map(([name, icon]) => (
              <div key={name} className="icon-row">
                <button
                  className="icon-btn"
                  title="Escolher ícone"
                  onClick={() => setPicking(picking === name ? null : name)}
                >
                  {icon ? <StatusIcon value={icon} size={15} /> : <span className="dim">—</span>}
                </button>
                {name}
                {picking === name && (
                  <IconPicker
                    value={icon}
                    onClose={() => setPicking(null)}
                    onPick={(v) => {
                      setPicking(null)
                      set({ statusIcons: { ...c.statusIcons, [name]: v } })
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="sp-card">
          <h3>Arquivos</h3>
          <p className="dim">
            Tudo fica em <code>{cfg.dir}</code>: <code>config.json</code> e{' '}
            <code>themes/*.json</code>. Editou e salvou, o app aplica na hora.
          </p>
          <button onClick={() => window.turnflow.openConfigDir()}>Abrir pasta de config</button>
        </section>

        <section className="sp-card" data-testid="settings-import">
          <h3>{IMPORT_COPY.screen.title}</h3>
          <ImportBrain brainDir={c.brainDir} />
          <ImportLegacy />
          <ExportMarkdown />
        </section>

        <section className="sp-card" data-testid="settings-wipe">
          <h3>{VAULT_SCREENS.wipeTitle}</h3>
          {/* sucesso: o vault.changed (first_run) desmonta o app e o portão mostra o primeiro uso */}
          <WipeAll embedded onWipe={(confirm) => orThrow(window.turnflow.vaultWipe({ confirm }))} />
        </section>
      </div>
    </div>
  )
}
