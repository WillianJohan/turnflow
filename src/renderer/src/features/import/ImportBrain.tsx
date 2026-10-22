import { useEffect, useRef, useState } from 'react'
import type { ImportPreview, ImportReport, TaskType } from '../../../../shared/contracts'
import { IMPORT_COPY } from '../../../../shared/copy/import'
import {
  applyInput,
  emptyChoices,
  parseTarget,
  previewInput,
  takeKey,
  targetValue,
  withStatus,
  withTake,
  withWorkdir,
  type ImportChoices
} from './choices'
import './import.css'

const COPY = IMPORT_COPY.screen
type Shown = { root: string; p: ImportPreview }

/**
 * Import do brain em markdown: pasta → prévia → escolhas → Apply → relatório. Cada escolha refaz a
 * prévia com as escolhas todas, e o Apply manda as mesmas com o `token` dessa prévia; se a pasta
 * mudou nesse meio (`preview_stale`), a prévia é refeita e o usuário é avisado.
 */
export function ImportBrain({ brainDir }: { brainDir: string | null }): React.JSX.Element {
  const [root, setRoot] = useState(brainDir ?? '')
  const [choices, setChoices] = useState<ImportChoices>(emptyChoices)
  const [choicesRoot, setChoicesRoot] = useState<string | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [types, setTypes] = useState<TaskType[]>([])
  // só a resposta da prévia mais recente vale (escolhas seguidas disparam várias)
  const seq = useRef(0)

  useEffect(() => {
    void window.turnflow.taskTypeList().then((r) => r.ok && setTypes(r.data))
  }, [])

  const runPreview = async (dir: string, c: ImportChoices): Promise<void> => {
    const n = ++seq.current
    setBusy('preview')
    setError(null)
    const r = await window.turnflow.importDryRun(previewInput(dir, c))
    if (n !== seq.current) return
    setBusy(null)
    if (r.ok) setShown({ root: dir, p: r.data })
    else {
      setShown(null)
      setError(r.error.message)
    }
  }

  const changeRoot = (v: string): void => {
    setRoot(v)
    // a prévia na tela é de outra pasta: o Apply não pode valer para esta
    if (shown && shown.root !== v.trim()) setShown(null)
  }

  const onPreview = (): void => {
    const dir = root.trim()
    const c = choicesRoot === dir ? choices : emptyChoices()
    setChoices(c)
    setChoicesRoot(dir)
    setReport(null)
    setNotice(null)
    void runPreview(dir, c)
  }

  const change = (c: ImportChoices): void => {
    if (!shown) return
    setChoices(c)
    setNotice(null)
    void runPreview(shown.root, c)
  }

  const browse = async (): Promise<void> => {
    const r = await window.turnflow.importPickFolder()
    if (r.ok && r.data.path) changeRoot(r.data.path)
  }

  const apply = async (): Promise<void> => {
    if (!shown) return
    setBusy('apply')
    setError(null)
    setNotice(null)
    const r = await window.turnflow.importApply(applyInput(shown.root, shown.p.token, choices))
    setBusy(null)
    if (r.ok) {
      setReport(r.data)
      setShown(null)
      setChoices(emptyChoices())
      return
    }
    const reason = (r.error.details as { reason?: unknown } | undefined)?.reason
    if (reason === 'preview_stale') {
      setNotice(COPY.previewRefreshed)
      await runPreview(shown.root, choices)
      return
    }
    setError(r.error.message)
  }

  return (
    <div className="import" data-testid="import">
      <p className="import-dim">{COPY.intro}</p>
      <div className="import-row">
        <label className="import-folder">
          {COPY.folder}
          <input
            data-testid="import-root"
            type="text"
            spellCheck={false}
            value={root}
            onChange={(e) => changeRoot(e.target.value)}
          />
        </label>
        <button data-testid="import-browse" disabled={busy !== null} onClick={() => void browse()}>
          {COPY.browse}
        </button>
        <button
          data-testid="import-preview"
          disabled={busy !== null || !root.trim()}
          onClick={onPreview}
        >
          {COPY.preview}
        </button>
      </div>
      {busy === 'preview' && (
        <p className="import-dim" aria-live="polite">
          {COPY.previewing}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="import-notice" className="import-warn">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="import-error" className="import-error">
          {error}
        </p>
      )}
      {shown && (
        <PreviewView p={shown.p} types={types} choices={choices} onChange={change} busy={!!busy} />
      )}
      <button
        data-testid="import-apply"
        className="import-primary"
        disabled={!shown || busy !== null}
        onClick={() => void apply()}
      >
        {busy === 'apply' ? COPY.applying : COPY.apply}
      </button>
      {report && <ReportView r={report} />}
    </div>
  )
}

/** Ações que escrevem na task: só nelas a sugestão de pasta de trabalho tem efeito. */
const WRITES = new Set(['create', 'update', 'link', 'record_only'])

// mesma ideia do `fold` do core (caixa, acento, espaço) só para achar a etapa na lista
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

function PreviewView({
  p,
  types,
  choices,
  onChange,
  busy
}: {
  p: ImportPreview
  types: TaskType[]
  choices: ImportChoices
  onChange(c: ImportChoices): void
  busy: boolean
}): React.JSX.Element {
  const typeOpts = types.some((t) => t.id === p.type_id)
    ? types
    : [{ id: p.type_id, name: p.type_id }, ...types]
  return (
    <div className="import-preview">
      <dl className="import-counts">
        {(Object.keys(COPY.counts) as (keyof typeof COPY.counts)[]).map((k) => (
          <div key={k}>
            <dt>{COPY.counts[k]}</dt>
            <dd data-testid={`import-count-${k}`}>{p.counts[k]}</dd>
          </div>
        ))}
      </dl>

      <label className="import-field">
        {COPY.type}
        <select
          data-testid="import-type"
          value={p.type_id}
          disabled={busy}
          onChange={(e) => onChange({ ...choices, type_id: e.target.value })}
        >
          {typeOpts.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {p.statuses.length > 0 && (
        <section>
          <h4>{COPY.statuses}</h4>
          {p.status_map.problem && (
            <p className="import-warn">{COPY.mapProblem[p.status_map.problem]}</p>
          )}
          {p.status_map.dropped > 0 && (
            <p className="import-warn">{COPY.mapDropped(p.status_map.dropped)}</p>
          )}
          <table className="import-table">
            <thead>
              <tr>
                <th>{COPY.statusCol}</th>
                <th>{COPY.tasksCol}</th>
                <th>{COPY.stageCol}</th>
              </tr>
            </thead>
            <tbody>
              {p.statuses.map((s) => (
                <tr key={s.key}>
                  <td>{s.status}</td>
                  <td>{s.count}</td>
                  <td>
                    <StatusSelect
                      s={s}
                      stages={p.stages}
                      disabled={busy}
                      onPick={(t) => onChange(withStatus(choices, s.key, t))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h4>{COPY.tasks}</h4>
        {p.tasks.length === 0 && <p className="import-dim">{COPY.noTasks}</p>}
        <ul className="import-tasks">
          {p.tasks.map((t) => (
            <li key={t.key} data-testid={`import-task-${t.key}`}>
              <div className="import-task-head">
                <span className="import-key">{t.key}</span>
                <span className="import-title">{t.title}</span>
                <span className="import-action" data-testid={`import-action-${t.key}`}>
                  {COPY.actions[t.action]}
                </span>
              </div>
              {t.reason && <p className="import-dim">{t.reason}</p>}
              {t.conflicts.map((c) => {
                const taken = choices.take_markdown.has(takeKey(t.key, c.field))
                const name = takeKey(t.key, c.field)
                return (
                  <fieldset key={c.field} className="import-conflict" disabled={busy}>
                    <legend>{COPY.conflict(COPY.fields[c.field])}</legend>
                    <label>
                      <input
                        type="radio"
                        name={name}
                        value="app"
                        checked={!taken}
                        onChange={() => onChange(withTake(choices, t.key, c.field, false))}
                      />
                      {COPY.keepApp}
                      <span className="import-value">{c.app}</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={name}
                        value="markdown"
                        checked={taken}
                        onChange={() => onChange(withTake(choices, t.key, c.field, true))}
                      />
                      {COPY.useMarkdown}
                      <span className="import-value">{c.markdown}</span>
                    </label>
                  </fieldset>
                )
              })}
              {t.workdir_hint && WRITES.has(t.action) && (
                <label className="import-check">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={choices.workdirs[t.key] === t.workdir_hint}
                    onChange={(e) =>
                      onChange(
                        withWorkdir(choices, t.key, e.target.checked ? t.workdir_hint : null)
                      )
                    }
                  />
                  {COPY.workdirSuggestion(t.workdir_hint)}
                </label>
              )}
            </li>
          ))}
        </ul>
      </section>

      {p.attachments.length > 0 && (
        <details data-testid="import-attachments">
          <summary>{COPY.attachments(p.attachments.length)}</summary>
          <p className="import-dim">{COPY.attachmentsHint}</p>
          <ul>
            {p.attachments.map((a) => (
              <li key={a.path}>
                {a.path} <span className="import-dim">({size(a.size)})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {p.ignored.length > 0 && (
        <details data-testid="import-ignored">
          <summary>{COPY.ignoredList(p.ignored.length)}</summary>
          <ul>
            {p.ignored.map((i) => (
              <li key={`${i.path}|${i.reason}`}>
                {i.path} <span className="import-dim">— {IMPORT_COPY.ignored[i.reason]}</span>
                {i.count !== undefined && <span className="import-dim"> ({i.count})</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function StatusSelect({
  s,
  stages,
  disabled,
  onPick
}: {
  s: ImportPreview['statuses'][number]
  stages: ImportPreview['stages']
  disabled: boolean
  onPick(t: NonNullable<ReturnType<typeof parseTarget>>): void
}): React.JSX.Element {
  const t = s.target
  const stage = t && 'stage' in t ? stages.find((st) => fold(st.name) === fold(t.stage)) : null
  const value = stage ? `stage:${stage.name}` : targetValue(t)
  // opção extra para o que a lista de etapas + "Blocked" não mostra
  let extra: string | null = null
  if (!t) extra = COPY.notMapped
  else if ('role' in t && t.role !== 'blocked') extra = COPY.roles[t.role]
  else if ('stage' in t && !stage) extra = COPY.missingStage(t.stage)
  return (
    <select
      data-testid={`import-status-${s.key}`}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const picked = parseTarget(e.target.value)
        if (picked) onPick(picked)
      }}
    >
      {extra !== null && <option value={value}>{extra}</option>}
      {stages.map((st) => (
        <option key={st.id} value={`stage:${st.name}`}>
          {st.name}
        </option>
      ))}
      <option value="role:blocked">{COPY.roles.blocked}</option>
    </select>
  )
}

function ReportView({ r }: { r: ImportReport }): React.JSX.Element {
  return (
    <section className="import-report" data-testid="import-report" aria-live="polite">
      <h4>{COPY.reportTitle}</h4>
      {r.warnings.map((w) => (
        <p key={w} className="import-warn">
          {IMPORT_COPY.warnings[w]}
        </p>
      ))}
      <dl className="import-counts">
        {(Object.keys(COPY.report) as (keyof typeof COPY.report)[]).map((k) => (
          <div key={k}>
            <dt>{COPY.report[k]}</dt>
            <dd data-testid={`import-report-${k}`}>{r[k]}</dd>
          </div>
        ))}
      </dl>
      {r.conflicts_kept.length > 0 && <p>{COPY.conflictsKept(r.conflicts_kept.length)}</p>}
      {r.taken_markdown.length > 0 && <p>{COPY.takenMarkdown(r.taken_markdown.length)}</p>}
      {r.deleted_in_app.length > 0 && <p>{COPY.deletedInApp(r.deleted_in_app.join(', '))}</p>}
      {r.invalid.map((i) => (
        <p key={i.key} className="import-warn">
          {COPY.invalidTask(i.key, i.reason)}
        </p>
      ))}
      {r.sessions_taken.map((s) => (
        <p key={s.external_id} className="import-dim">
          {COPY.sessionTaken(s.external_id, s.task_key)}
        </p>
      ))}
    </section>
  )
}

function size(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
