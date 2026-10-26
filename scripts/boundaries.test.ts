import { ESLint } from 'eslint'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const fixtures = resolve(__dirname, 'lint-fixtures')

// fixtures ficam em `ignores` do lint do repo; aqui o ignore é desligado
const lint = async (rel: string): Promise<{ errors: number; messages: string[]; file: string }> => {
  const eslint = new ESLint({ cwd: resolve(__dirname, '..'), ignore: false })
  const [r] = await eslint.lintFiles([resolve(fixtures, rel)])
  return {
    errors: r.errorCount,
    messages: r.messages.map((m) => m.ruleId + ': ' + m.message),
    file: r.filePath
  }
}

describe('fronteiras de módulo', () => {
  it('core não importa electron', async () => {
    const r = await lint('src/core/bad-core.ts')
    expect(r.errors).toBe(1)
    expect(r.file).toContain('bad-core.ts')
    expect(r.messages[0]).toContain('no-restricted-imports')
  })
  it('preload não importa módulo Node', async () => {
    const r = await lint('src/preload/bad-preload.ts')
    expect(r.errors).toBe(1)
    expect(r.file).toContain('bad-preload.ts')
    expect(r.messages[0]).toContain('no-restricted-imports')
  })
  it('preload não importa pacote npm', async () => {
    const r = await lint('src/preload/bad-preload-npm.ts')
    expect(r.errors).toBe(1)
    expect(r.file).toContain('bad-preload-npm.ts')
    expect(r.messages[0]).toContain('no-restricted-imports')
  })
  it('feature não importa outra feature', async () => {
    const r = await lint('src/renderer/src/features/a/bad-feature.ts')
    expect(r.errors).toBe(1)
    expect(r.file).toContain('bad-feature.ts')
    expect(r.messages[0]).toContain('no-restricted-imports')
  })
  it('shared não importa core (o renderer importa shared)', async () => {
    const r = await lint('src/shared/bad-shared-core.ts')
    expect(r.errors).toBe(1)
    expect(r.file).toContain('bad-shared-core.ts')
    expect(r.messages[0]).toContain('shared não importa core')
  })
  it('renderer não importa core', async () => {
    const r = await lint('src/renderer/src/bad-core-import.ts')
    expect(r.errors).toBe(1)
    expect(r.file).toContain('bad-core-import.ts')
    expect(r.messages[0]).toContain('no-restricted-imports')
    expect(r.messages[0]).toContain('renderer não importa core')
  })
  it('renderer não importa o índice do core (sem subpath)', async () => {
    const r = await lint('src/renderer/src/bad-core-index-import.ts')
    expect(r.errors).toBe(1)
    expect(r.messages[0]).toContain('renderer não importa core')
  })
  it('arquivo de feature também não importa core (bloco de feature redefine a regra)', async () => {
    const r = await lint('src/renderer/src/features/c/bad-feature-core.ts')
    expect(r.errors).toBe(1)
    expect(r.file).toContain('bad-feature-core.ts')
    expect(r.messages[0]).toContain('renderer não importa core')
  })
  it('a feature vizinha, sozinha, passa limpa', async () => {
    expect((await lint('src/renderer/src/features/b/index.ts')).errors).toBe(0)
  })
})
