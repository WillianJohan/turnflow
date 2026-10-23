import { useState } from 'react'
import { headerFace, menuItems, summaryPatch, type MenuId } from './taskFace'

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
  const [menu, setMenu] = useState(false)
  const ordered = [...stages].sort((a, b) => a.position - b.position)
  const showUndo = toast !== null && now < toast.until

  return (
    <div className="task-head">
      <div className="th">
        <span className="th-title">
          <b>{taskKey}</b> — {title}
        </span>
        <span className="th-actions">
          {trailing}
          <button
            onClick={() => setMenu((open) => !open)}
            aria-expanded={menu}
            aria-label="Task menu"
          >
            ⋯
          </button>
        </span>
      </div>
      {menu && (
        <ul className="task-menu">
          {menuItems(blocked).map((item) => (
            <li key={item.id}>
              <button
                onClick={() => {
                  setMenu(false)
                  onAction(item.id)
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="stage-bar" role="group" aria-label="Stage">
        {ordered.map((stage) => (
          <button
            key={stage.id}
            aria-current={stage.id === stageId ? 'step' : undefined}
            onClick={() => onStage(stage.id)}
          >
            {stage.short_name}
          </button>
        ))}
      </div>
      {editing ? (
        <form
          className="task-summary"
          onSubmit={(event) => {
            event.preventDefault()
            onSave(summaryPatch(what, next))
            setEditing(false)
          }}
        >
          <label>
            Stopped at
            <input value={what} onChange={(event) => setWhat(event.target.value)} />
          </label>
          <label>
            Next
            <input value={next} onChange={(event) => setNext(event.target.value)} />
          </label>
          <button type="submit">Save</button>
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
              setWhat(face.lines[0].text)
              setNext(face.lines[1].text)
              setEditing(true)
            }}
          >
            {face.edit}
          </button>
        </div>
      )}
      {showUndo && (
        <div className="toast" role="status">
          <button onClick={onUndo}>Undo</button>
        </div>
      )}
    </div>
  )
}
