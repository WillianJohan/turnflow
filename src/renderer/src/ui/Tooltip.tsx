import { cloneElement, useId, useState } from 'react'

type Describable = React.ReactElement<{ 'aria-describedby'?: string }>

/**
 * Dica de um controle. Fica escondida até o ponteiro passar ou o controle ganhar foco, e Esc a
 * esconde. O texto descreve o filho (aria-describedby); o tabstop é o do próprio filho.
 */
export function Tooltip({
  label,
  children
}: {
  label: string
  children: Describable
}): React.JSX.Element {
  const id = useId()
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const show = (hover || focus) && !dismissed
  return (
    <span
      className="ui-tip"
      onMouseEnter={() => {
        setHover(true)
        setDismissed(false)
      }}
      onMouseLeave={() => setHover(false)}
      onFocus={() => {
        setFocus(true)
        setDismissed(false)
      }}
      onBlur={() => setFocus(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && show) setDismissed(true)
      }}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span id={id} className="ui-tip-bubble" role="tooltip" hidden={!show}>
        {label}
      </span>
    </span>
  )
}
