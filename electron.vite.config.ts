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

// Build de teste (TURNFLOW_BUILD=test) liga os ganchos de teste; no release a constante vira false
// e o bundler elimina o ramo (conferido por scripts/check-release.ts).
const define = { __TURNFLOW_TEST__: JSON.stringify(process.env.TURNFLOW_BUILD === 'test') }

export default defineConfig({
  main: { define },
  preload: { define },
  renderer: {
    define,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), devCsp]
  }
})
