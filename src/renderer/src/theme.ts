import type { AppConfig, Theme } from '../../shared/types'
import { setTermTheme } from './terms'

const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
const family = (f: string, fallback: string): string =>
  f === 'system-ui' ? fallback : `"${f}", ${fallback}`

// Variáveis CSS da UI. O hex mora nos temas embutidos; aqui só se aplica o que eles entregam.
export function paintUi(theme: Theme): void {
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme.ui)) root.style.setProperty(`--${kebab(k)}`, v)
  const bg = (theme.ui.bg ?? '').replace('#', '')
  const lum =
    parseInt(bg.slice(0, 2), 16) + parseInt(bg.slice(2, 4), 16) + parseInt(bg.slice(4, 6), 16)
  root.style.colorScheme = Number.isNaN(lum) || lum > 382 ? 'light' : 'dark'
}

// Variáveis CSS da UI (cores e fonte do app) + tema/fonte de todos os xterms.
export function applyTheme(theme: Theme, cfg: AppConfig): void {
  const root = document.documentElement
  paintUi(theme)
  root.style.setProperty('--app-font', family(cfg.appFont, 'system-ui, sans-serif'))
  root.style.setProperty('--app-font-size', `${cfg.appFontSize}px`)
  setTermTheme(theme.terminal, cfg.fontSize, family(cfg.termFont, "'JetBrains Mono', monospace"))
}
