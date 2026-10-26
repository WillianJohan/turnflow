import { useState } from 'react'

export function Menu({
  label,
  items,
  onPick,
  open
}: {
  label: string
  items: { id: string; label: string }[]
  onPick?(id: string): void
  open?: boolean
}): React.JSX.Element {
  const [local, setLocal] = useState(open ?? false)
  const shown = open ?? local
  return (
    <div className="menu-wrap">
      <button
        type="button"
        className="ui-target"
        aria-expanded={shown}
        aria-haspopup="menu"
        onClick={() => setLocal((value) => !value)}
      >
        {label}
      </button>
      {shown && (
        <ul className="menu" role="menu">
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                className="ui-target"
                onClick={() => {
                  setLocal(false)
                  onPick?.(item.id)
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
