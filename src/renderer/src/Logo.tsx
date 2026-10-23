import { BRAND } from '../../shared/brand'

// Logo: um prompt de terminal — "❯ <id>" e o cursor de bloco piscando.
export const Logo = (): React.JSX.Element => (
  <span className="logo" aria-label={BRAND.name}>
    <span className="logo-prompt">❯</span>
    <span className="logo-name">{BRAND.id}</span>
    <span className="logo-cursor" />
  </span>
)
