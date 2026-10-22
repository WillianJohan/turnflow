import { builtinModules } from 'node:module'
import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

// Fronteiras de módulo (testadas em scripts/boundaries.test.ts com scripts/lint-fixtures)
const nodeBuiltins = builtinModules.filter((m) => !m.startsWith('_'))
const crossFeature = (depth) => ({
  regex: `^(\\.\\./){${depth}}[^./]`,
  message: 'Feature não importa outra feature: suba o código compartilhado para fora de features/.'
})
const featureFiles = (depth) => `**/src/renderer/src/features/*/*${'/*'.repeat(depth)}.{ts,tsx}`

const boundaries = [
  {
    files: ['**/src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'core é puro: sem electron.' }],
          patterns: [
            {
              group: ['**/main/**', '**/renderer/**', '**/preload/**'],
              message: 'core não depende de main/renderer/preload.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['**/src/preload/**/*.{ts,tsx}'],
    ignores: ['**/*.d.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltins.map((name) => ({
            name,
            message: 'preload não usa módulos Node: passe por IPC.'
          })),
          patterns: [{ group: ['node:*'], message: 'preload não usa módulos Node: passe por IPC.' }]
        }
      ]
    }
  },
  // um bloco por profundidade (regra de blocos posteriores substitui a anterior, então globs disjuntos)
  ...[0, 1, 2, 3].map((d) => ({
    files: [featureFiles(d)],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            crossFeature(d + 1),
            {
              group: ['@renderer/features/*'],
              message: 'Use import relativo dentro da própria feature.'
            }
          ]
        }
      ]
    }
  }))
]

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out', 'scripts/lint-fixtures/**'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  ...boundaries,
  eslintConfigPrettier
)
