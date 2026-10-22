import { defineConfig } from 'vitest/config'

// Testes de integração (FS/processos reais): *.int.test.ts. O vitest.config.ts (unit) os exclui.
export default defineConfig({
  define: { __TURNFLOW_TEST__: 'true' },
  test: { include: ['src/**/*.int.test.ts', 'scripts/**/*.int.test.ts'], passWithNoTests: true }
})
