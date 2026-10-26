import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __TURNFLOW_TEST__: 'true' },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.int.test.ts']
  }
})
