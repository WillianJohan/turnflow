import { useState } from 'react'
import { SHELL_COPY } from '../../shared/copy/shell'
import { headerFace, menuItems, summaryPatch, type MenuId } from './taskFace'
import { Menu } from './ui/Menu'
import { StageBar } from './ui/StageBar'
import { TextField } from './ui/TextField'
import { Toast } from './ui/Toast'

type Stage = { id: string; short_name: string; position: number }

type Props = {
  taskKey: string
  title: string
  summary: {
    sum_what: string | null
    sum_where: string | null
    sum_next: string | null
    checkpoints: { at: string; text: string }[]
  }
  stages: Stage[]
  stageId: string
  blocked: boolean
  toast: { activityId: string; until: number } | null
  now: number
  onSave(patch: { sum_what: string | null; sum_next: string | null }): void
  onStage(id: string): void
  onAction(id: MenuId): void
  onUndo(): void
  trailing?: React.ReactNode
}

export function TaskHeader({
  taskKey,
  title,
  summary,
  stages,
  stageId,
  blocked,
  toast,
  now,
  onSave,
  onStage,
  onAction,
  onUndo,
  trailing
}: Props): React.JSX.Element {
  const face = headerFace(summary)
  const [editing, setEditing] = useState(false)
  const [what, setWhat] = useState(face.lines[0].text)
  const [next, setNext] = useState(face.lines[1].text)
  const showUndo = toast !== null && now < toast.until

  return (
    <div className="task-head">
      <div className="th">
        <span className="th-title">
          <b>{taskKey}</b> — {title}
        </span>
        <span className="th-actions">
          {trailing}
          <Menu
            label="⋯"
            ariaLabel={SHELL_COPY.header.menu}
            items={menuItems(blocked)}
            onPick={(id) => onAction(id as MenuId)}
          />
        </span>
      </div>
      <StageBar stages={stages} current={stageId} onPick={onStage} />
      {editing ? (
        <form
          className="task-summary"
          onSubmit={(event) => {
            event.preventDefault()
            onSave(summaryPatch(what, next))
            setEditing(false)
          }}
        >
          <TextField label={SHELL_COPY.header.stoppedAt} value={what} onChange={setWhat} />
          <TextField label={SHELL_COPY.header.next} value={next} onChange={setNext} />
          <button type="submit">{SHELL_COPY.header.save}</button>
        </form>
      ) : (
        <div className="task-summary">
          <p>
            <span className="k">{face.lines[0].label}</span> {face.lines[0].text}
          </p>
          <p>
            <span className="k">{face.lines[1].label}</span> {face.lines[1].text}
          </p>
          <button
            onClick={() => {
              // "último registro" é só a cara do cabeçalho: não vira resumo ao salvar
              setWhat(face.lines[0].placeholder ? '' : face.lines[0].text)
              setNext(face.lines[1].placeholder ? '' : face.lines[1].text)
              setEditing(true)
            }}
          >
            {face.edit}
          </button>
        </div>
      )}
      {showUndo && <Toast action={SHELL_COPY.undo} onAction={onUndo} />}
    </div>
  )
}
