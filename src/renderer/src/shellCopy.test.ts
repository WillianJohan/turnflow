import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, it } from 'vitest'

// Telas do E6.1–E6.5: texto de UI vem do SHELL_COPY (inglês). Atributo de texto literal ou letra
// acentuada fora de comentário é string solta (o E6.9 não acharia para traduzir).
const FILES = [
  'App.tsx',
  'Panels.tsx',
  'Sidebar.tsx',
  'AttentionList.tsx',
  'attentionFields.ts',
  'HomeView.tsx',
  'homeBoard.ts',
  'Palette.tsx',
  'palette.ts',
  'NewMenu.tsx',
  'ProjectDialog.tsx',
  'ShortcutDialog.tsx',
  'TaskView.tsx',
  'TaskHeader.tsx',
  'taskFace.ts',
  'TimelineView.tsx',
  'commands.ts',
  'layout.ts'
]

const code = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n')

it.each(FILES)('%s não tem texto de UI solto', (file) => {
  const src = code(readFileSync(join(__dirname, file), 'utf8'))
  expect(src.match(/\b(title|aria-label|placeholder|label)="[^"]*[A-Za-z][^"]*"/g) ?? []).toEqual(
    []
  )
  // nomes de bucket do brain (dado do usuário) são a única exceção acentuada
  const accented = src.match(/['"`][^'"`\n]*[à-úÀ-Ú][^'"`\n]*['"`]/g) ?? []
  expect(accented.filter((s) => !/Concluído|Arquivada/.test(s))).toEqual([])
})
