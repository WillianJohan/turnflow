import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

// Fronteiras de módulo (testadas em scripts/boundaries.test.ts com scripts/lint-fixtures)
const crossFeature = (depth) => ({
  regex: `^(\\.\\./){${depth}}[^./]`,
  message: 'Feature não importa outra feature: suba o código compartilhado para fora de features/.'
})
// renderer ↛ core: o core roda no main; o renderer só enxerga o que passa por IPC/shared.
// Todo bloco que redefine no-restricted-imports para o renderer precisa repetir este padrão.
const noCoreFromRenderer = {
  group: ['**/core', '**/core/**', '@core', '@core/**'],
  message: 'renderer não importa core: use IPC (src/shared) em vez de acessar o core direto.'
}
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
    files: ['**/src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core', '**/core/**', '**/main/**', '**/renderer/**', '**/preload/**'],
              message: 'shared não importa core nem main/renderer: o renderer importa shared.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['**/src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noCoreFromRenderer] }]
    }
  },
  {
    files: ['**/src/preload/**/*.{ts,tsx}'],
    ignores: ['**/*.d.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // só `electron` e relativos (./api, ../shared/types); nada de Node nem npm
              regex: '^(?!electron$|\\.{1,2}/).+',
              message: 'preload importa apenas electron (e tipos locais): o resto passa por IPC.'
            }
          ]
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
            noCoreFromRenderer,
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
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/out-test', 'scripts/lint-fixtures/**'] },
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
