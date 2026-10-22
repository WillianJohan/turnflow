import { defineConfig } from 'vitest/config'

// Testes de integração (FS/processos reais): *.int.test.ts. O vitest.config.ts (unit) os exclui.
// Teto de 30 s: vários testes derivam a chave com Argon2id real (64 MiB, JS puro), que no
// runner do CI leva bem mais que na máquina local.
export default defineConfig({
  define: { __TURNFLOW_TEST__: 'true' },
  test: {
    include: ['src/**/*.int.test.ts', 'scripts/**/*.int.test.ts'],
    passWithNoTests: true,
    testTimeout: 30_000
  }
})
