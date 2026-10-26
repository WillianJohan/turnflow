import { defineConfig } from '@playwright/test'

// E2E do app empacotado pelo build de teste (`npm run build:test` → out-test/).
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list'
})
