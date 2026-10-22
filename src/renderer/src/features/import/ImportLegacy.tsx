import { useState } from 'react'
import { IMPORT_COPY } from '../../../../shared/copy/import'
import type { LegacyApplyResult, LegacyPlan } from '../../../../shared/ipc/import'
import './import.css'

const COPY = IMPORT_COPY.legacy

const actionText = (t: LegacyPlan['themes'][number]): string => {
  switch (t.action) {
    case 'create':
    case 'skip_same':
      return COPY.actions[t.action](t.to ?? t.from)
    default:
      return COPY.actions[t.action]
  }
}

/**
 * Migra temas e config do app legado: botão → prévia em lista → Apply → resultado. A prévia não
 * escreve nada; se a pasta mudou até o Apply (`preview_stale`), a prévia é refeita e o usuário é avisado.
 */
export function ImportLegacy(): React.JSX.Element {
  const [plan, setPlan] = useState<LegacyPlan | null>(null)
  const [result, setResult] = useState<LegacyApplyResult | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const preview = async (): Promise<boolean> => {
    setBusy('preview')
    setError(null)
    const r = await window.turnflow.importLegacyDryRun()
    setBusy(null)
    if (r.ok) {
      setPlan(r.data)
      return true
    }
    setPlan(null)
    setNotice(null)
    setError(r.error.message)
    return false
  }

  const start = async (): Promise<void> => {
    setResult(null)
    setNotice(null)
    await preview()
  }

  const apply = async (): Promise<void> => {
    if (!plan) return
    setBusy('apply')
    setError(null)
    setNotice(null)
    const r = await window.turnflow.importLegacyApply({ token: plan.token })
    setBusy(null)
    if (r.ok) {
      setResult(r.data)
      setPlan(null)
      return
    }
    const reason = (r.error.details as { reason?: unknown } | undefined)?.reason
    if (reason === 'preview_stale') {
      if (await preview()) setNotice(COPY.previewRefreshed)
      return
    }
    setError(r.error.message)
  }

  const configKeys = plan ? Object.keys(plan.config) : []
  const nothing =
    plan !== null && !plan.themes.some((t) => t.action === 'create') && !configKeys.length

  return (
    <div className="import" data-testid="import-legacy">
      <p className="import-dim">{COPY.intro}</p>
      <div className="import-row">
        <button data-testid="legacy-preview" disabled={busy !== null} onClick={() => void start()}>
          {COPY.button}
        </button>
      </div>
      <div aria-live="polite">
        {busy === 'preview' && <p className="import-dim">{COPY.previewing}</p>}
        {notice && (
          <p data-testid="legacy-notice" className="import-warn">
            {notice}
          </p>
        )}
        {result && (
          <p data-testid="legacy-done">
            {COPY.done(result.themes_created, result.config_keys.length)}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" data-testid="legacy-error" className="import-error">
          {error}
        </p>
      )}
      {result && result.skipped.length > 0 && (
        <p className="import-warn">{COPY.skippedFiles(result.skipped.join(', '))}</p>
      )}
      {plan && (
        <div data-testid="legacy-plan">
          <h4>{COPY.themes}</h4>
          {plan.themes.length === 0 ? (
            <p className="import-dim">{COPY.noThemes}</p>
          ) : (
            <ul>
              {plan.themes.map((t) => (
                <li key={t.from} data-action={t.action}>
                  {t.name} <span className="import-dim">{actionText(t)}</span>
                </li>
              ))}
            </ul>
          )}
          {configKeys.length > 0 && (
            <>
              <h4>{COPY.settings}</h4>
              <ul>
                {configKeys.map((k) => (
                  <li key={k}>
                    {k}: <code>{String(plan.config[k as keyof typeof plan.config])}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          {plan.ignored_keys.length > 0 && (
            <p className="import-dim">{COPY.ignored(plan.ignored_keys.join(', '))}</p>
          )}
          {nothing && <p className="import-dim">{COPY.nothing}</p>}
        </div>
      )}
      {plan && (
        <button
          data-testid="legacy-apply"
          className="import-primary"
          disabled={busy !== null || nothing}
          onClick={() => void apply()}
        >
          {busy === 'apply' ? COPY.applying : COPY.apply}
        </button>
      )}
    </div>
  )
}
