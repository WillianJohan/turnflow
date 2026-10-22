/// <reference types="vite/client" />
import type { RendererApi } from '../../shared/ipc/api'

declare global {
  interface Window {
    turnflow: RendererApi
  }
  // true só no build de teste; no release o bundler troca por false e elimina o ramo
  const __TURNFLOW_TEST__: boolean
}
