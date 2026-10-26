/** Etiqueta curta. `danger` é o tom de alerta (Bloq.): a cor vem do tom, não da tela que usa. */
export function Tag({
  children,
  tone = 'neutral'
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'danger'
}): React.JSX.Element {
  return (
    <span className="ui-tag" data-tone={tone}>
      {children}
    </span>
  )
}
