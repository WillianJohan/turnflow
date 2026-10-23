import type { TimelineItem } from './taskFace'

type Props = {
  items: TimelineItem[]
  onResume(id: string): void
  onNew(): void
}

export function TimelineView({ items, onResume, onNew }: Props): React.JSX.Element {
  return (
    <div className="timeline">
      <div className="timeline-actions">
        <button className="primary" onClick={onNew}>
          New session
        </button>
      </div>
      <ol>
        {items.map((item) => (
          <li key={`${item.kind}:${item.id}`}>
            <span className="timeline-kind">
              {item.kind === 'checkpoint' ? 'Record' : 'Session'}
            </span>
            <span>{item.text}</span>
            {item.resumable && <button onClick={() => onResume(item.id)}>Resume</button>}
          </li>
        ))}
      </ol>
    </div>
  )
}
