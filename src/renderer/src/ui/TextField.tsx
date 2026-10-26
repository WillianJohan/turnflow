export function TextField({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange(value: string): void
}): React.JSX.Element {
  return (
    <label className="ui-field">
      {label}
      <input
        className="ui-target"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
