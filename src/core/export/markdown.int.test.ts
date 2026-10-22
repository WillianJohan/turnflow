import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { DomainChanged } from '../../shared/ipc/events'
import { createDomain, type DomainDeps } from '../domain/context'
import { DomainError } from '../domain/errors'
import { addCheckpoint } from '../domain/checkpoint'
import { createProject } from '../domain/project'
import { getTask, listTasks } from '../domain/rows'
import { closeTask, createTask, deleteTask } from '../domain/task'
import { applyBrain, previewBrain } from '../import/markdown'
import { writeBrain } from '../import/markdown/testing/brainFixture'
import type { StatusMapFile } from '../import/markdown/statusMap'
import { openTestDb, tmpDir } from '../testing/db'
import { exportMarkdown, nodeExportFs, type ExportFs } from './markdown'

const NOW = '2026-10-22T12:34:56.000Z'
const MAP: StatusMapFile = { version: 1, entries: {} }
const UUID1 = '0b5e2c1a-1111-4aaa-8bbb-000000000001'
const UUID2 = '0b5e2c1a-1111-4aaa-8bbb-000000000002'

function domain(): DomainDeps {
  return createDomain({
    db: openTestDb(),
    afterCommit: vi.fn<(c: DomainChanged) => void>(),
    now: () => new Date(NOW)
  })
}

const task = (d: DomainDeps, title: string, description?: string): string => {
  const r = createTask(d, { kind: 'user' }, { title, description })
  return r.row!.id
}

async function importBrain(d: DomainDeps, root: string): Promise<void> {
  const o = { status_map: MAP }
  const p = await previewBrain(d, root, o)
  await applyBrain(d, root, o, p.token)
}

const listing = (dir: string): string[] => readdirSync(dir).sort()
const read = (...p: string[]): string => readFileSync(join(...p), 'utf8')

describe('exportMarkdown', () => {
  it('uma pasta por task com README: vivas em current, concluída em done, apagada ausente', async () => {
    const d = domain()
    const a = task(d, 'Alpha', 'alpha body')
    const b = task(d, 'Beta', 'beta body')
    const c = task(d, 'Gamma')
    const x = task(d, 'Gone')
    addCheckpoint(d, { kind: 'user' }, { task_id: a, text: 'did a thing\nin two lines' })
    closeTask(d, { kind: 'user' }, { id: c })
    deleteTask(d, { kind: 'user' }, { id: x })
    const keys = (ids: string[]): string[] => ids.map((i) => getTask(d, i).key).sort()

    const dest = tmpDir()
    const r = await exportMarkdown(d, dest)
    expect(r.tasks).toBe(3)
    expect(r.dir).toBe(join(dest, 'turnflow-export-20261022-123456'))
    expect(listing(r.dir)).toEqual(['current', 'done'])
    expect(listing(join(r.dir, 'current'))).toEqual(keys([a, b]))
    expect(listing(join(r.dir, 'done'))).toEqual(keys([c]))
    const keyA = getTask(d, a).key
    const md = read(r.dir, 'current', keyA, 'README.md')
    expect(md).toContain('alpha body')
    expect(md).toContain('## Checkpoints')
    expect(md).toContain('did a thing\n  in two lines')
    expect(statSync(join(r.dir, 'current', keyA, 'README.md')).mode & 0o777).toBe(0o600)
    expect(statSync(r.dir).mode & 0o777).toBe(0o700)
  })

  it('ida e volta: importar, exportar e importar o export em outro banco', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'tasks/current/ABC-1/README.md': [
        '# ABC-1 — Synthetic epic',
        '',
        'Status: Implementation',
        '**Blocked:** waiting on a vendor',
        '**Project:** Alpha',
        '**Type:** Bugfix',
        '',
        'First paragraph.',
        '',
        '## Notes',
        '',
        'extra notes',
        '',
        '## MRs',
        '',
        '- repo => https://example.com/g/r/-/merge_requests/1',
        '',
        '## Sessions',
        '',
        `- 2026-01-01 — ${UUID1} — scope`,
        `- 2026-01-05 — ${UUID2}`,
        '',
        '## Checkpoints',
        '',
        '- 2026-01-02 — first step',
        '  with a second line',
        '- 2026-01-03T10:20:30Z — later step',
        ''
      ].join('\n'),
      'tasks/current/ABC-2/README.md': '# ABC-2 — Other\n\nStatus: Review\n\nplain description\n',
      'tasks/done/ABC-3/README.md': '# ABC-3 — Finished\n\nStatus: Done\n\nall good\n'
    })
    const d1 = domain()
    await importBrain(d1, root)

    const dest = tmpDir()
    const { dir, tasks } = await exportMarkdown(d1, dest)
    expect(tasks).toBe(3)
    expect(listing(join(dir, 'done'))).toEqual(['ABC-3'])

    const d2 = domain()
    await importBrain(d2, dir)

    const snap = (d: DomainDeps): unknown =>
      [...listTasks(d, 'attention'), ...listTasks(d, {})]
        .map((r) => {
          const t = getTask(d, r.id)
          const pj = r.project_id
            ? (
                d.db.prepare('select name from project where id = ?').get(r.project_id) as {
                  name: string
                }
              ).name
            : null
          const ty = (
            d.db.prepare('select name from task_type where id = ?').get(t.type_id) as {
              name: string
            }
          ).name
          return {
            key: t.key,
            title: t.title,
            stage: t.stage.name,
            blocked_reason: t.blocked_reason,
            project: pj,
            type: ty,
            description: t.description.trimEnd(),
            checkpoints: t.checkpoints.map((c) => [c.at, c.text]),
            sessions: t.sessions.map((s) => [s.external_id, s.label])
          }
        })
        .sort((a, b) => (a.key < b.key ? -1 : 1))
    const first = snap(d1) as { key: string }[]
    expect(first.map((t) => t.key)).toEqual(['ABC-1', 'ABC-2', 'ABC-3'])
    expect(first[0]).toMatchObject({
      blocked_reason: 'waiting on a vendor',
      project: 'Alpha',
      type: 'Bugfix'
    })
    expect(snap(d2)).toEqual(first)
    expect((first[0] as unknown as { description: string }).description).toContain(
      'merge_requests/1'
    )
  })

  it('ida e volta de descrição sem cabeçalho e com metadado/seções dentro', async () => {
    const d1 = domain()
    const descs = ['texto simples', 'Status: x\nmais', 'intro\n\n## Notes\n\nbody']
    descs.forEach((s, i) => task(d1, `T${i}`, s))
    const { dir } = await exportMarkdown(d1, tmpDir())
    const d2 = domain()
    await importBrain(d2, dir)
    const byTitle = (d: DomainDeps): string[] =>
      listTasks(d, 'attention')
        .map((r) => [r.title, getTask(d, r.id).description] as const)
        .sort()
        .map(([t, s]) => `${t}=${s}`)
    expect(byTitle(d2)).toEqual(byTitle(d1))
    expect(byTitle(d2)).toContain('T0=texto simples')
    expect(byTitle(d2)).toContain('T1=Status: x\nmais')
  })

  it('projeto, tipo e etapa saem pelo nome', async () => {
    const d = domain()
    const p = createProject(d, { kind: 'user' }, { name: 'Alpha' } as never)
    const r = createTask(d, { kind: 'user' }, { title: 'In project', project_id: p.id })
    const { dir } = await exportMarkdown(d, tmpDir())
    const md = read(dir, 'current', getTask(d, r.row!.id).key, 'README.md')
    expect(md).toContain('**Project:** Alpha')
    expect(md).toMatch(/\*\*Type:\*\* \S/)
    expect(md).toMatch(/\nStatus: \S/)
  })

  it('não escreve fora da pasta nova e não deixa .partial', async () => {
    const d = domain()
    task(d, 'A')
    const dest = tmpDir()
    mkdirSync(join(dest, 'existing'))
    const before = listing(dest)
    const { dir } = await exportMarkdown(d, dest)
    const after = listing(dest)
    expect(after.filter((n) => !before.includes(n))).toEqual([dir.slice(dest.length + 1)])
    expect(after.some((n) => n.endsWith('.partial'))).toBe(false)
    expect(listing(join(dest, 'existing'))).toEqual([])
  })

  it('checkpoints e sessões saem do mais antigo ao mais novo', async () => {
    const d = domain()
    const id = task(d, 'A')
    const ins = d.db.prepare(
      "insert into checkpoint(id, task_id, at, text, source) values (?, ?, ?, ?, 'user')"
    )
    ins.run('c2', id, '2026-03-02T00:00:00.000Z', 'cp-newer')
    ins.run('c1', id, '2026-03-01T00:00:00.000Z', 'cp-older')
    const sess = d.db.prepare(
      "insert into ai_session(id, task_id, tool, external_id, state, state_at, started_at, label) values (?, ?, 'claude', ?, 'idle', ?, ?, ?)"
    )
    sess.run('s2', id, UUID2, '2026-03-02T00:00:00.000Z', '2026-03-02T00:00:00.000Z', 'newer')
    sess.run('s1', id, UUID1, '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', 'older')
    const { dir } = await exportMarkdown(d, tmpDir())
    const md = read(dir, 'current', getTask(d, id).key, 'README.md')
    expect(md.indexOf('cp-older')).toBeGreaterThan(0)
    expect(md.indexOf('cp-older')).toBeLessThan(md.indexOf('cp-newer'))
    expect(md.indexOf(UUID1)).toBeLessThan(md.indexOf(UUID2))
  })

  it('segundo export no mesmo segundo ganha -2 e não toca no primeiro', async () => {
    const d = domain()
    task(d, 'A')
    const dest = tmpDir()
    const a = await exportMarkdown(d, dest)
    const b = await exportMarkdown(d, dest)
    expect(b.dir).toBe(`${a.dir}-2`)
    expect(listing(dest)).toHaveLength(2)
  })

  it('falha no meio não deixa pasta nem .partial', async () => {
    const d = domain()
    task(d, 'A')
    task(d, 'B')
    task(d, 'C')
    const dest = tmpDir()
    let writes = 0
    const fs: ExportFs = {
      ...nodeExportFs,
      writeFile: async (p, data) => {
        if (++writes === 2) throw new Error('disk full')
        return nodeExportFs.writeFile(p, data)
      }
    }
    await expect(exportMarkdown(d, dest, fs)).rejects.toThrow('disk full')
    expect(listing(dest)).toEqual([])
  })

  it('dest relativo, inexistente ou arquivo é VALIDATION', async () => {
    const d = domain()
    const dir = tmpDir()
    writeBrain(dir, { 'file.txt': 'x' })
    for (const dest of ['relative/dir', join(dir, 'missing'), join(dir, 'file.txt')]) {
      const e = await exportMarkdown(d, dest).catch((x: unknown) => x)
      expect(e).toBeInstanceOf(DomainError)
      expect((e as DomainError).code).toBe('VALIDATION')
      expect((e as DomainError).details).toMatchObject({ reason: 'export_dest_invalid' })
    }
  })

  it('keys que colidem como nome de pasta ganham -2', async () => {
    const d = domain()
    const a = task(d, 'A')
    const b = task(d, 'B')
    d.db.prepare('update task set key = ? where id = ?').run('X/1', a)
    d.db.prepare('update task set key = ? where id = ?').run('X_1', b)
    const { dir } = await exportMarkdown(d, tmpDir())
    expect(listing(join(dir, 'current'))).toEqual(['X_1', 'X_1-2'])
  })
})
