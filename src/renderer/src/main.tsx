import './assets/main.css'
import './ui/ui.css'
import { createRoot } from 'react-dom/client'
import { DEFAULT_THEME } from '../../shared/theme/builtins'
import App from './App'
import { VaultGate } from './features/vault/VaultGate'
import { paintUi } from './theme'

paintUi(DEFAULT_THEME)

// soltar arquivo fora do terminal não faz nada (o main também bloqueia a navegação)
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <VaultGate>
    <App />
  </VaultGate>
)
