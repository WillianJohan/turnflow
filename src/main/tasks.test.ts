import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { bucketOf, loadTasks, parseReadme, watchTasks } from './tasks'

describe('bucketOf', () => {
  it.each([
    ['Validação CS', 'current', 6, 'Validação CS'],
    ['em teste produção — na principal', 'current', 7, 'Em teste produção'],
    ['concluída', 'current', 8, 'Concluído'],
    ['GMUD 13/10', 'current', 2, 'GMUD'],
    ['merge request', 'current', 1, 'Merge request'],
    ['Bloqueada', 'current', 5, 'Bloqueado'],
    ['em andamento', 'current', 3, 'Em andamento'],
    ['refinamento', 'current', 4, 'Tarefas'],
    ['em teste', 'current', 3, 'Em andamento'],
    ['entregue', 'current', 8, 'Concluído'],
    ['xyz', 'current', 10, 'Outros'],
    ['em andamento', 'done', 9, 'Arquivada']
  ] as const)('%s (%s)', (status, dir, idx, name) => {
    expect(bucketOf(status, dir)).toEqual({ idx, name })
  })
})

const UUID = '6cf3f5b1-5d12-4759-bb5b-09a9aaea132f'
const UUID2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('parseReadme', () => {
  it('lê título, status, pai e sessões', () => {
    const text = [
      '# T-1234 — Título X',
      '',
      'Status: em andamento',
      '',
      '## Sessões',
      `- 2026-10-14 — ${UUID2} — início`,
      `- 2026-10-15 — ${UUID} — análise`,
      '',
      '## Checkpoints',
      `- 2026-10-16: citou ${UUID2} aqui`,
      ...Array(180).fill('linha'),
      '**Pai:** T-9'
    ].join('\n')
    const t = parseReadme(text, 'T-1234', 'current', '/x/README.md')
    expect(t.title).toBe('Título X')
    expect(t.status).toBe('em andamento')
    expect(t.bucket).toEqual({ idx: 3, name: 'Em andamento' })
    expect(t.parent).toBe('T-9')
    expect(t.sessions).toEqual([
      { date: '2026-10-14', uuid: UUID2, desc: 'início' },
      { date: '2026-10-15', uuid: UUID, desc: 'análise' }
    ])
  })

  it('aceita **Status:**', () => {
    expect(parseReadme('# T-1 — a\n**Status:** merge request\n', 'T-1', 'current', '').status).toBe(
      'merge request'
    )
  })

  it('README vazio não quebra', () => {
    const t = parseReadme('', 'T-77', 'current', '')
    expect(t.title).toBe('T-77')
    expect(t.bucket).toEqual({ idx: 10, name: 'Outros' })
    expect(t.parent).toBeNull()
    expect(t.sessions).toEqual([])
  })
})

describe('loadTasks', () => {
  it('varre current e done e ignora pasta sem README', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dk-'))
    await mkdir(join(root, 'current/T-1'), { recursive: true })
    await mkdir(join(root, 'current/T-2'), { recursive: true })
    await mkdir(join(root, 'done/T-3'), { recursive: true })
    await writeFile(join(root, 'current/T-1/README.md'), '# T-1 — um\nStatus: em andamento\n')
    await writeFile(join(root, 'done/T-3/README.md'), '# T-3 — três\nStatus: em andamento\n')
    const ts = await loadTasks(root)
    expect(ts.map((t) => [t.id, t.dir, t.bucket.name]).sort()).toEqual([
      ['T-1', 'current', 'Em andamento'],
      ['T-3', 'done', 'Arquivada']
    ])
  })
})

describe('watchTasks', () => {
  it('pasta do brain inexistente não derruba o app', () => {
    expect(() => watchTasks('/nao/existe/brain', () => undefined)()).not.toThrow()
  })
})
