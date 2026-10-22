import { defineConfig } from 'vitest/config'

// Testes de integração (FS/processos reais): *.int.test.ts. O vitest.config.ts (unit) os exclui.
export default defineConfig({
  test: { include: ['src/**/*.int.test.ts'], passWithNoTests: true }
})
