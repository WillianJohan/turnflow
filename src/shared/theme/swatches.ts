// Paleta do seletor de ícones: cor que o usuário escolhe pro ícone, não cor de tema. É o único
// arquivo fora da derivação e dos temas embutidos onde hex é permitido (scripts/check-colors.ts).
import { SCREENS_COPY } from '../copy/screens'

const N = SCREENS_COPY.iconPicker.swatches

// Valor que <input type="color"> mostra quando o campo ainda não tem cor: um cinza médio, que
// aparece nos dois esquemas (preto some no escuro).
export const COLOR_INPUT_FALLBACK = '#888888'

export const ICON_SWATCHES: readonly { hex: string; label: string }[] = [
  { hex: '#91918e', label: N.gray },
  { hex: '#a27763', label: N.brown },
  { hex: '#cb7b37', label: N.orange },
  { hex: '#c29243', label: N.yellow },
  { hex: '#4f9768', label: N.green },
  { hex: '#2e7cd1', label: N.blue },
  { hex: '#8d5bc1', label: N.purple },
  { hex: '#c94a8c', label: N.pink },
  { hex: '#cd5049', label: N.red }
]
