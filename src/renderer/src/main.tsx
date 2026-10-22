import './assets/main.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import { VaultGate } from './features/vault/VaultGate'

// soltar arquivo fora do terminal não faz nada (o main também bloqueia a navegação)
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <VaultGate>
    <App />
  </VaultGate>
)
