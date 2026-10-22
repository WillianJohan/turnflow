import { describe, expect, it } from 'vitest'
import { parseTaskReadme } from '../import/markdown/parse'
import { renderReadme, safeDirName, type ExportTask } from './render'

const UUID = '0b5e2c1a-1111-4aaa-8bbb-000000000001'

const task = (o: Partial<ExportTask> = {}): ExportTask => ({
  key: 'ABC-1',
  title: 't',
  stage: 'Implementation',
  blocked_reason: null,
  project: null,
  type: 'Feature',
  workdir: null,
  description: '',
  sum: { what: null, where: null, next: null },
  checkpoints: [],
  sessions: [],
  ...o
})

describe('renderReadme', () => {
  it('sai legível: metadados, checkpoint de 2 linhas e sessão', () => {
    const md = renderReadme(
      task({
        blocked_reason: 'waiting on a vendor',
        project: 'Alpha',
        workdir: '/work/dir',
        checkpoints: [
          { at: '2026-01-02T10:00:00.000Z', text: 'first line\nsecond line' },
          { at: '2026-01-03T10:00:00.000Z', text: 'later' }
        ],
        sessions: [
          { at: '2026-01-01T09:00:00.000Z', external_id: UUID, tool: 'claude', label: 'scope' },
          { at: '2026-01-01T09:00:00.000Z', external_id: 'abc', tool: 'codex', label: null }
        ]
      })
    )
    expect(md).toContain('# ABC-1 — t\n')
    expect(md).toContain('\nStatus: Implementation\n')
    expect(md).toContain('**Blocked:** waiting on a vendor')
    expect(md).toContain('**Project:** Alpha')
    expect(md).toContain('**Type:** Feature')
    expect(md).toContain('**Workdir:** /work/dir')
    expect(md).toContain('## Checkpoints')
    expect(md).toContain('- 2026-01-02T10:00:00.000Z — first line\n  second line\n')
    expect(md.indexOf('2026-01-02T')).toBeLessThan(md.indexOf('2026-01-03T'))
    expect(md).toContain('## Sessions')
    expect(md).toContain(`- 2026-01-01 — ${UUID} — scope`)
    expect(md).toContain('- 2026-01-01 — codex\n')
  })

  it('só os metadados presentes', () => {
    const md = renderReadme(task())
    expect(md).not.toMatch(/Blocked|Project|Workdir/)
  })

  it('descrição sai crua, sem `## Description`, com e sem `## ` no começo', () => {
    for (const description of ['plain text\n\nmore', '## Notes\n\nbody']) {
      const md = renderReadme(task({ description }))
      expect(md).not.toContain('## Description')
      expect(md).toContain(`**Type:** Feature\n\n${description}\n`)
    }
  })

  it('sem sum_* não tem Summary; com, tem', () => {
    expect(renderReadme(task())).not.toContain('## Summary')
    const md = renderReadme(task({ sum: { what: 'w', where: null, next: 'n' } }))
    expect(md).toContain('## Summary\n\n- What: w\n- Next: n\n')
    expect(md).not.toContain('Where')
  })

  it('safeDirName troca o que não é seguro e nunca devolve `.`/`..`', () => {
    expect(safeDirName('A/B')).toBe('A_B')
    expect(safeDirName('ABC-1.x_y')).toBe('ABC-1.x_y')
    expect(safeDirName('..')).toBe('__')
    expect(safeDirName('')).toBe('_')
    expect(safeDirName('a\\b:c')).toBe('a_b_c')
  })

  it('ida e volta pelo parser: descrição com metadado, `## Notes` e `## Sessions` voltam iguais', () => {
    for (const description of [
      'Status: x\nmore text',
      'Blocked: nobody asked\nProject: Phantom',
      'intro\n\n## Notes\n\nbody',
      'intro\n\n## Sessions\n- just a note',
      '## Notes\n\nbody'
    ]) {
      const t = task({
        description,
        sessions: [
          { at: '2026-01-01T09:00:00.000Z', external_id: UUID, tool: 'claude', label: 'x' }
        ],
        checkpoints: [{ at: '2026-01-02T10:00:00.000Z', text: 'cp' }]
      })
      const p = parseTaskReadme(renderReadme(t), 'ABC-1')
      expect(p.description).toBe(description)
      expect(p.status).toBe('Implementation')
      expect(p.blocked).toBeNull()
      expect(p.project_name).toBeNull()
      expect(p.sessions.map((s) => s.external_id)).toEqual([UUID])
      expect(p.checkpoints.map((c) => c.text)).toEqual(['cp'])
    }
  })
})
