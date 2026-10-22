import { useEffect, useRef } from 'react'
import { attachTerm, disposeTerm, getTerm } from './terms'
import { orThrow } from './ipc'

const ID = '__update__'

// Popup com o /revisao-demandas rodando; fechar mata o processo e recarrega a lista.
export function UpdateModal({ onClose }: { onClose(): void }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const e = attachTerm(ID, host.current!)
    e.term.focus()
    orThrow(window.turnflow.startUpdate({ cols: e.term.cols, rows: e.term.rows })).catch((x) =>
      e.term.write(
        `\x1b[31mnão deu pra abrir a revisão: ${String(x?.message ?? x).replace(/^Error invoking[^:]+: (Error: )?/, '')}\x1b[0m\r\n`
      )
    )
    const ro = new ResizeObserver(() => e.fit.fit())
    ro.observe(host.current!)
    return () => {
      ro.disconnect()
      window.turnflow.kill({ id: ID })
      disposeTerm(ID)
    }
  }, [])

  return (
    <div className="overlay" onKeyDown={(e) => e.key === 'Escape' && e.shiftKey && onClose()}>
      <div className="update" role="dialog" aria-label="Revisão de demandas">
        <div className="th">
          <span className="th-title">
            <b>Atualizar</b> — revisão de demandas (Jira × brain)
          </span>
          <span className="th-actions">
            <button
              onClick={onClose}
              title="Fecha, encerra a revisão e recarrega a lista (Shift+Esc)"
            >
              Fechar
            </button>
          </span>
        </div>
        <div className="term" ref={host} onMouseDown={() => getTerm(ID).term.focus()} />
      </div>
    </div>
  )
}
