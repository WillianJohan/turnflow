type Stage = { id: string; short_name: string; position: number }

export function StageBar({
  stages,
  current,
  onPick,
  label = 'Stage'
}: {
  stages: Stage[]
  current: string
  onPick(id: string): void
  label?: string
}): React.JSX.Element {
  const ordered = [...stages].sort((a, b) => a.position - b.position)
  return (
    <div className="stage-bar" role="group" aria-label={label}>
      {ordered.map((stage) => (
        <button
          key={stage.id}
          type="button"
          className="ui-target"
          aria-current={stage.id === current ? 'step' : undefined}
          onClick={() => onPick(stage.id)}
        >
          {stage.short_name}
        </button>
      ))}
    </div>
  )
}
