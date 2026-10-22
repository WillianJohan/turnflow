import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Só no dev: o Vite injeta o preamble do React-refresh inline e fala por websocket (HMR).
// O release continua 'self' puro (a meta do index.html).
const devCsp = {
  name: 'turnflow-dev-csp',
  apply: 'serve' as const,
  transformIndexHtml: (html: string): string =>
    html.replace(
      "script-src 'self';",
      "script-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:*;"
    )
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), devCsp]
  }
})
