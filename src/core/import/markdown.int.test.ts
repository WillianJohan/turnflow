import { createHash } from 'node:crypto'
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync
} from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  Limits,
  type ImportPreviewTask,
  type ImportReport,
  type TaskDetail
} from '../../shared/contracts'
import type { DomainChanged } from '../../shared/ipc/events'
import type { Db } from '../db/open'
import { createDomain, type DomainDeps } from '../domain/context'
import { importCreateTaskIn, importUpdateTaskIn } from '../domain/importTask'
import { purgeTask } from '../db/purge'
import { DomainError } from '../domain/errors'
import { deleteProject } from '../domain/project'
import { getTask } from '../domain/rows'
import { createTask, deleteTask, updateTask } from '../domain/task'
import { listActivity } from '../domain/undo'
import { dumpTables, openTestDb, seedIds, tmpDir } from '../testing/db'
import { applyBrain, previewBrain } from './markdown'
import { applyImport } from './markdown/apply'
import { parseTaskReadme } from './markdown/parse'
import { planImport, type ImportOptions, type ImportPlan, type PlannedTask } from './markdown/plan'
import { readRecord, sha, writeRecordIn } from './markdown/record'
import { nodeBrainFs, scanBrain, type BrainFs } from './markdown/scan'
import type { StatusMapFile } from './markdown/statusMap'
import { readme, writeBrain } from './markdown/testing/brainFixture'

const NOW = '2026-10-22T12:00:00.000Z'
const EMPTY_MAP: StatusMapFile = { version: 1, entries: {} }
const UUID1 = '0b5e2c1a-1111-4aaa-8bbb-000000000001'
const MR1 = 'repo => https://example.com/g/r/-/merge_requests/1'

type Env = {
  db: Db
  d: DomainDeps
  root: string
  ids: ReturnType<typeof seedIds>
  after: ReturnType<typeof vi.fn<(c: DomainChanged) => void>>
}

function setup(files: Record<string, string> = {}): Env {
  const db = openTestDb()
  const after = vi.fn<(c: DomainChanged) => void>()
  const d = createDomain({ db, afterCommit: after, now: () => new Date(NOW) })
  const root = tmpDir()
  writeBrain(root, files)
  return { db, d, root, ids: seedIds(db), after }
}

/** Toda prévia é só leitura: nenhum caminho (create, merge, link, record) escreve no banco. */
async function plan(e: Env, o: Partial<ImportOptions> = {}): Promise<ImportPlan> {
  const scan = await scanBrain(e.root)
  const before = [totalChanges(e.db), e.after.mock.calls.length]
  const p = planImport(e.d, scan, { status_map: EMPTY_MAP, ...o })
  expect([totalChanges(e.db), e.after.mock.calls.length]).toEqual(before)
  return p
}

const row = (p: ImportPlan, key: string): ImportPreviewTask => {
  const r = p.preview.tasks.find((t) => t.key === key)
  if (!r) throw new Error(`sem ${key} na prévia`)
  return r
}
const op = (p: ImportPlan, key: string): PlannedTask => p.tasks.find((t) => t.key === key)!

/**
 * Aplicação mínima só para preparar o banco nos testes de reimport (o `applyImport` é do Task 6):
 * creates/updates sem projeto, e o record com `task_id` e `imported_at`.
 */
function applyForTest(e: Env, p: ImportPlan): void {
  e.d.tx((emit) => {
    for (const t of p.tasks) {
      if (t.kind === 'create') {
        expect(t.project).toBeNull()
        const r = importCreateTaskIn(e.d, emit, { ...t.create, project_id: null })
        writeRecordIn(e.db, { ...t.record, task_id: r.task_id, imported_at: NOW })
      } else if (t.kind === 'update') {
        expect(t.project).toBeUndefined()
        importUpdateTaskIn(e.d, emit, { ...t.update, task_id: t.task_id })
        writeRecordIn(e.db, { ...t.record, imported_at: NOW })
      }
    }
  })
}

const totalChanges = (db: Db): number =>
  (db.prepare('select total_changes() as n').get() as { n: number }).n
const taskCount = (db: Db): number =>
  (db.prepare('select count(*) as n from task').get() as { n: number }).n

describe('prévia', () => {
  it('lista tasks, status distintos e anexos', async () => {
    const e = setup({
      'tasks/current/ABC-1/README.md': readme({ key: 'ABC-1', status: 'in progress' }),
      'tasks/current/ABC-1/notes.txt': 'synthetic attachment',
      'tasks/current/ABC-2/README.md': readme({ key: 'ABC-2', status: 'weird status' }),
      'tasks/done/ABC-3/README.md': readme({ key: 'ABC-3', status: 'whatever' })
    })
    const p = await plan(e)
    expect(p.preview.tasks.map((t) => [t.key, t.action])).toEqual([
      ['ABC-1', 'create'],
      ['ABC-2', 'create'],
      ['ABC-3', 'create']
    ])
    expect(p.preview.statuses).toEqual([
      {
        status: 'in progress',
        key: 'in progress',
        count: 1,
        target: { role: 'working' },
        source: 'seed'
      },
      { status: 'weird status', key: 'weird status', count: 1, target: null, source: 'none' }
    ])
    const c1 = op(p, 'ABC-1')
    expect(c1.kind === 'create' && c1.create.stage.stage_id).toBe(e.ids.stages.Feature[1])
    expect(p.preview.attachments).toEqual([
      expect.objectContaining({ key: 'ABC-1', name: 'notes.txt', size: 20 })
    ])
    expect(p.preview.counts.create).toBe(3)
    expect(p.preview.type_id).toBe(e.ids.types.Feature)
    expect(p.preview.flow_id).toBe(e.ids.flows.Feature)
    expect(p.preview.stages.map((s) => s.id)).toEqual(e.ids.stages.Feature)
  })

  it('status sem mapeamento ganha o checkpoint de status importado, depois do último', async () => {
    const e = setup({
      'tasks/current/ABC-2/README.md': readme({
        key: 'ABC-2',
        status: 'weird status',
        checkpoints: ['2026-01-02 — first', '2026-01-05 — last']
      })
    })
    const c = op(await plan(e), 'ABC-2')
    if (c.kind !== 'create') throw new Error('esperava create')
    expect(c.create.stage.stage_id).toBe(e.ids.stages.Feature[0])
    expect(c.create.checkpoints.at(-1)).toEqual({
      at: '2026-01-05T12:00:02.000Z',
      text: 'Imported status: weird status'
    })
    expect(c.create.created_at).toBe('2026-01-02T12:00:00.000Z')
    expect(c.create.touched_at).toBe('2026-01-05T12:00:02.000Z')
  })

  it('prévia não escreve', async () => {
    const e = setup({
      'tasks/current/ABC-1/README.md': readme({ key: 'ABC-1', status: 'in progress' })
    })
    const before = [totalChanges(e.db), taskCount(e.db)]
    await plan(e)
    expect([totalChanges(e.db), taskCount(e.db)]).toEqual(before)
    expect(e.after).toHaveBeenCalledTimes(0)
  })

  it('credentials aparecem como ignorados', async () => {
    const secret = 'SYNTHETIC-SECRET-a91f0c'
    const e = setup({
      'credentials/service.md': `token: ${secret}`,
      'tasks/current/ABC-1/README.md': readme({ key: 'ABC-1' })
    })
    const p = await plan(e)
    expect(p.preview.ignored[0]).toEqual(expect.objectContaining({ reason: 'credentials' }))
    expect(JSON.stringify(p)).not.toContain(secret)
  })

  it('mapa salvo com problema aparece na prévia', async () => {
    const e = setup({ 'tasks/current/ABC-1/README.md': readme({ key: 'ABC-1' }) })
    expect((await plan(e)).preview.status_map).toEqual({ problem: null, dropped: 0 })
    const p = await plan(e, { status_map_health: { problem: 'invalid', dropped: 2 } })
    expect(p.preview.status_map).toEqual({ problem: 'invalid', dropped: 2 })
  })

  it('Pai vira projeto', async () => {
    const e = setup({
      'tasks/current/ABC-1/README.md': readme({ key: 'ABC-1', title: 'Synthetic epic' }),
      'tasks/current/ABC-2/README.md': readme({ key: 'ABC-2', parent: 'ABC-1' })
    })
    const p = await plan(e)
    expect(p.preview.projects).toEqual([
      { source_key: 'key:ABC-1', name: 'Synthetic epic', action: 'create' }
    ])
    expect(p.projects).toEqual([{ source_key: 'key:ABC-1', name: 'Synthetic epic' }])
    expect(row(p, 'ABC-1').project).toBe('Synthetic epic')
    expect(row(p, 'ABC-2').project).toBe('Synthetic epic')
    const ref = { source_key: 'key:ABC-1', name: 'Synthetic epic' }
    expect(op(p, 'ABC-1')).toEqual(expect.objectContaining({ kind: 'create', project: ref }))
    expect(op(p, 'ABC-2')).toEqual(expect.objectContaining({ kind: 'create', project: ref }))
  })

  it('projeto já importado é reusado, e o apagado no app não volta', async () => {
    const e = setup({
      'tasks/current/ABC-2/README.md': readme({ key: 'ABC-2', parent: 'ABC-1' }),
      'tasks/current/XYZ-2/README.md': readme({ key: 'XYZ-2', parent: 'XYZ-1' })
    })
    e.db
      .prepare("insert into project(id, name, flow_id) values ('p1', 'Kept epic', ?)")
      .run(e.ids.flows.Personal)
    e.db
      .prepare('insert into import_project(source_key, project_id, imported_at) values (?, ?, ?)')
      .run('key:ABC-1', 'p1', NOW)
    e.db
      .prepare('insert into import_project(source_key, project_id, imported_at) values (?, ?, ?)')
      .run('key:XYZ-1', null, NOW)
    const p = await plan(e)
    expect(p.preview.projects).toEqual([
      { source_key: 'key:ABC-1', name: 'Kept epic', action: 'existing' },
      { source_key: 'key:XYZ-1', name: 'XYZ-1', action: 'deleted_in_app' }
    ])
    expect(p.projects.map((r) => r.source_key)).toEqual(['key:ABC-1'])
    const a = op(p, 'ABC-2')
    if (a.kind !== 'create') throw new Error('esperava create')
    // fluxo do projeto vence o do tipo
    expect(a.create.flow_id).toBe(e.ids.flows.Personal)
    expect(e.ids.stages.Personal).toContain(a.create.stage.stage_id)
    expect(op(p, 'XYZ-2')).toEqual(expect.objectContaining({ kind: 'create', project: null }))
    expect(row(p, 'XYZ-2').project).toBeNull()
  })

  it('key existente vira link', async () => {
    const e = setup({
      'tasks/current/ABC-9/README.md': readme({
        key: 'ABC-9',
        title: 'Markdown title',
        checkpoints: ['2026-01-02 — note']
      })
    })
    const t = createTask(e.d, { kind: 'user' }, { title: 'App title' }).row!
    e.db.prepare("update task set key = 'ABC-9' where id = ?").run(t.id)
    const p = await plan(e)
    const r = row(p, 'ABC-9')
    expect(r.action).toBe('link')
    expect(r.conflicts).toContainEqual({
      key: 'ABC-9',
      field: 'title',
      app: 'App title',
      markdown: 'Markdown title'
    })
    expect(r.new_checkpoints).toBe(1)
    const u = op(p, 'ABC-9')
    if (u.kind !== 'update') throw new Error('esperava update')
    expect(u.task_id).toBe(t.id)
    expect(u.update.set?.title).toBeUndefined()
    expect(p.preview.counts.link).toBe(1)
    expect(p.preview.counts.conflicts).toBe(r.conflicts.length)
  })

  it('link com conflito de etapa e descrição acrescenta os links', async () => {
    const e = setup({
      'tasks/current/ABC-9/README.md': readme({
        key: 'ABC-9',
        title: 'App title',
        status: 'in progress',
        body: 'Markdown body.',
        mrs: [MR1]
      })
    })
    const t = createTask(e.d, { kind: 'user' }, { title: 'App title' }).row!
    e.db.prepare("update task set key = 'ABC-9' where id = ?").run(t.id)
    const p = await plan(e)
    const r = row(p, 'ABC-9')
    expect(r.action).toBe('link')
    expect(r.conflicts.map((c) => c.field)).toEqual(['description', 'stage'])
    expect(r.conflicts.find((c) => c.field === 'stage')).toEqual(
      expect.objectContaining({ app: 'Refinement', markdown: 'Implementation' })
    )
    expect(r.new_links).toBe(1)
    const u = op(p, 'ABC-9')
    if (u.kind !== 'update') throw new Error('esperava update')
    expect(u.update.set).toBeUndefined()
    expect(u.update.append_links).toEqual([`- ${MR1}`])
    // título igual dos dois lados: converge, sem conflito
    expect(u.record.field_hashes.title.app).toBe(sha('App title'))
    // conflito mantido no link: o app continua "editado" para o próximo md
    expect(u.record.field_hashes.stage.app).toBe('')
  })

  it('key apagada no app sem record = deleted_in_app', async () => {
    const e = setup({ 'tasks/current/ABC-9/README.md': readme({ key: 'ABC-9' }) })
    const t = createTask(e.d, { kind: 'user' }, { title: 'App title' }).row!
    e.db.prepare("update task set key = 'ABC-9', deleted_at = ? where id = ?").run(NOW, t.id)
    const p = await plan(e)
    expect(row(p, 'ABC-9').action).toBe('deleted_in_app')
    expect(op(p, 'ABC-9')).toEqual({ kind: 'none', key: 'ABC-9' })
  })

  it('token estável', async () => {
    const e = setup({
      'tasks/current/ABC-1/README.md': readme({ key: 'ABC-1', status: 'in progress' }),
      'tasks/current/ABC-2/README.md': readme({ key: 'ABC-2', status: 'weird status' })
    })
    const a = await plan(e)
    const b = await plan(e)
    expect(a.preview.token).toMatch(/^[0-9a-f]{64}$/)
    expect(b.preview.token).toBe(a.preview.token)
    const remapped = await plan(e, {
      status_map: { version: 1, entries: { 'in progress': { role: 'review' } } }
    })
    expect(remapped.preview.token).not.toBe(a.preview.token)
    // mapa de status que nenhuma task usa não muda o que o apply faz
    const unused = await plan(e, {
      status_map: { version: 1, entries: { 'nobody uses': { role: 'review' } } }
    })
    expect(unused.preview.token).toBe(a.preview.token)
  })

  it('token muda quando a sessão passa a ser de outra task no banco', async () => {
    const e = setup({
      'tasks/current/ABC-1/README.md': readme({
        key: 'ABC-1',
        sessions: [`2026-01-01 — ${UUID1} — scope`]
      })
    })
    const a = await plan(e)
    expect(row(a, 'ABC-1').new_sessions).toBe(1)
    const other = createTask(e.d, { kind: 'user' }, { title: 'Other' }).row!
    e.db
      .prepare(
        `insert into ai_session(id, task_id, tool, external_id, state, state_at, started_at)
         values ('s1', ?, 'claude-code', ?, 'unknown', ?, ?)`
      )
      .run(other.id, UUID1, NOW, NOW)
    const b = await plan(e)
    expect(row(b, 'ABC-1').new_sessions).toBe(0)
    expect(b.preview.token).not.toBe(a.preview.token)
  })

  it('sugestão de pasta', async () => {
    const e = setup({
      'tasks/current/ABC-1/README.md': '# ABC-1 — T\n\n**Worktree:** /tmp/wt/ABC-1\n'
    })
    const p = await plan(e)
    expect(row(p, 'ABC-1').workdir_hint).toBe('/tmp/wt/ABC-1')
    const c = op(p, 'ABC-1')
    expect(c.kind === 'create' && c.create.workdir).toBeNull()
    const chosen = op(await plan(e, { workdirs: { 'ABC-1': '/tmp/wt/ABC-1' } }), 'ABC-1')
    expect(chosen.kind === 'create' && chosen.create.workdir).toBe('/tmp/wt/ABC-1')
  })

  it('inválida', async () => {
    const e = setup({
      'tasks/current/ABC-1/README.md': readme({
        key: 'ABC-1',
        checkpoints: [`2026-01-02 — ${'x'.repeat(20_001)}`]
      })
    })
    const p = await plan(e)
    expect(row(p, 'ABC-1')).toEqual(
      expect.objectContaining({ action: 'invalid', reason: 'too_long:checkpoint' })
    )
    expect(op(p, 'ABC-1')).toEqual({ kind: 'none', key: 'ABC-1' })
    expect(p.preview.counts.invalid).toBe(1)
  })

  it.each([
    ['title', { title: 'x'.repeat(Limits.title + 1) }, {}],
    ['blocked_reason', { status: `blocked: ${'x'.repeat(Limits.reason + 1)}` }, {}],
    ['workdir', {}, { workdirs: { 'ABC-1': `/${'x'.repeat(Limits.workdir)}` } }]
  ] as const)('campo %s acima do limite = inválida', async (field, md, o) => {
    const e = setup({ 'tasks/current/ABC-1/README.md': readme({ key: 'ABC-1', ...md }) })
    expect(row(await plan(e, o), 'ABC-1').reason).toBe(`too_long:${field}`)
  })

  it('descrição com links acima do limite', async () => {
    const md = (mrs?: string[]): string => {
      // o corpo de 1 caractere mede o cabeçalho que o readme() põe em volta
      const head = readme({ key: 'ABC-1', body: 'x' })
      const pad = Limits.description - 10 - (parseTaskReadme(head, 'ABC-1').description.length - 1)
      return readme({ key: 'ABC-1', body: 'x'.repeat(pad), mrs })
    }
    expect(parseTaskReadme(md(), 'ABC-1').description.length).toBe(Limits.description - 10)
    const e = setup({ 'tasks/current/ABC-1/README.md': md() })
    expect(row(await plan(e), 'ABC-1').action).toBe('create')
    writeBrain(e.root, { 'tasks/current/ABC-1/README.md': md([MR1]) })
    expect(row(await plan(e), 'ABC-1')).toEqual(
      expect.objectContaining({ action: 'invalid', reason: 'too_long:description' })
    )
  })

  it('nome de projeto longo cai na key', async () => {
    const e = setup({
      'tasks/current/ABC-1/README.md': readme({ key: 'ABC-1', title: 'y'.repeat(150) }),
      'tasks/current/ABC-2/README.md': readme({ key: 'ABC-2', parent: 'ABC-1' })
    })
    const p = await plan(e)
    expect(p.preview.projects[0]!.name).toBe('ABC-1')
    expect(p.projects[0]!.name).toBe('ABC-1')
  })

  it('create já traz o bloco de links', async () => {
    const e = setup({
      'tasks/current/ABC-1/README.md': readme({ key: 'ABC-1', mrs: [MR1, MR1] })
    })
    const p = await plan(e)
    const c = op(p, 'ABC-1')
    if (c.kind !== 'create') throw new Error('esperava create')
    expect(c.create.description).toMatch(
      /\n\n## Links\n\n- repo => https:\/\/example\.com\/g\/r\/-\/merge_requests\/1$/
    )
    expect(c.record.field_hashes.links).toEqual(['https://example.com/g/r/-/merge_requests/1'])
    expect(row(p, 'ABC-1').new_links).toBe(1)
  })

  it('sessões e checkpoints do create, e o record com o md sem links e o app com links', async () => {
    const e = setup({
      'tasks/current/ABC-1/README.md': readme({
        key: 'ABC-1',
        status: 'in progress',
        mrs: [MR1],
        sessions: [`2026-01-01 — ${UUID1} — scope`],
        checkpoints: ['2026-01-02 — a', '2026-01-02 — a']
      })
    })
    const p = await plan(e)
    const c = op(p, 'ABC-1')
    if (c.kind !== 'create') throw new Error('esperava create')
    expect(c.create.sessions).toEqual([
      { external_id: UUID1, at: '2026-01-01T12:00:00.000Z', label: 'scope' }
    ])
    expect(c.create.created_at).toBe('2026-01-01T12:00:00.000Z')
    expect(row(p, 'ABC-1')).toEqual(
      expect.objectContaining({ new_checkpoints: 1, new_sessions: 1 })
    )
    const parsed = parseTaskReadme(
      readme({ key: 'ABC-1', status: 'in progress', mrs: [MR1] }),
      'ABC-1'
    )
    expect(c.record.field_hashes.description).toEqual({
      md: sha(parsed.description),
      app: sha(c.create.description!)
    })
    expect(c.record.source_path).toBe('current/ABC-1/README.md')
  })
})

describe('prévia de reimport (record existente)', () => {
  const md = (
    o: { title?: string; status?: string; mrs?: string[]; cps?: string[] } = {}
  ): string =>
    readme({
      key: 'ABC-1',
      title: o.title ?? 'First title',
      status: o.status ?? 'in progress',
      mrs: o.mrs,
      checkpoints: o.cps ?? ['2026-01-02 — a']
    })
  const README = 'tasks/current/ABC-1/README.md'

  async function imported(): Promise<Env & { id: string }> {
    const e = setup({ [README]: md() })
    applyForTest(e, await plan(e))
    const id = readRecord(e.db, 'ABC-1')!.task_id!
    return { ...e, id }
  }

  it('o record do create casa com o que o app gravou: arquivo igual = unchanged sem op', async () => {
    const e = await imported()
    const p = await plan(e)
    expect(row(p, 'ABC-1').action).toBe('unchanged')
    expect(op(p, 'ABC-1')).toEqual({ kind: 'none', key: 'ABC-1' })
  })

  it('conteúdo mudou sem mudar campo nenhum: só o record anda, sem conflito', async () => {
    const e = await imported()
    appendFileSync(join(e.root, README), '\n\n')
    const p = await plan(e)
    expect(row(p, 'ABC-1')).toEqual(
      expect.objectContaining({ action: 'record_only', conflicts: [], fields: [] })
    )
    expect(p.preview.counts).toEqual(
      expect.objectContaining({ record_only: 1, update: 0, unchanged: 0 })
    )
    const u = op(p, 'ABC-1')
    if (u.kind !== 'update') throw new Error('esperava update só do record')
    expect(u.update).toEqual({ task_id: e.id })
    expect(u.record.file_hash).not.toBe(readRecord(e.db, 'ABC-1')!.file_hash)
  })

  it('mesmo hash e path diferente não é unchanged: current→done vai para a etapa final', async () => {
    const e = await imported()
    mkdirSync(join(e.root, 'tasks/done'), { recursive: true })
    renameSync(join(e.root, 'tasks/current/ABC-1'), join(e.root, 'tasks/done/ABC-1'))
    const p = await plan(e)
    const u = op(p, 'ABC-1')
    if (u.kind !== 'update') throw new Error('esperava update')
    expect(u.task_id).toBe(e.id)
    expect(u.update.set?.stage).toEqual({
      stage_id: e.ids.stages.Feature.at(-1),
      blocked_reason: null
    })
    expect(u.record.source_path).toBe('done/ABC-1/README.md')
    expect(u.record.file_hash).toBe(readRecord(e.db, 'ABC-1')!.file_hash)
    expect(row(p, 'ABC-1').fields).toEqual(['stage'])
  })

  it('mudou só no md: entra no set', async () => {
    const e = await imported()
    writeBrain(e.root, { [README]: md({ title: 'New md title' }) })
    const p = await plan(e)
    const u = op(p, 'ABC-1')
    if (u.kind !== 'update') throw new Error('esperava update')
    expect(u.update.set).toEqual({ title: 'New md title' })
    expect(u.record.field_hashes.title).toEqual({
      md: sha('New md title'),
      app: sha('New md title')
    })
    expect(row(p, 'ABC-1')).toEqual(
      expect.objectContaining({ action: 'update', fields: ['title'], conflicts: [] })
    )
  })

  it('mudou no md e no app: conflito, o app fica e só o md do record anda', async () => {
    const e = await imported()
    const before = readRecord(e.db, 'ABC-1')!
    updateTask(e.d, { kind: 'user' }, e.id, { title: 'App title' })
    writeBrain(e.root, { [README]: md({ title: 'New md title' }) })
    const p = await plan(e)
    expect(row(p, 'ABC-1').conflicts).toEqual([
      { key: 'ABC-1', field: 'title', app: 'App title', markdown: 'New md title' }
    ])
    const u = op(p, 'ABC-1')
    if (u.kind !== 'update') throw new Error('esperava update')
    expect(u.update.set).toBeUndefined()
    expect(u.record.field_hashes.title).toEqual({
      md: sha('New md title'),
      app: before.field_hashes.title.app
    })

    // só o conflito mantido: o apply grava só o record, então não é `update`
    expect(row(p, 'ABC-1')).toEqual(expect.objectContaining({ action: 'record_only', fields: [] }))
    expect(p.preview.counts).toEqual(
      expect.objectContaining({ record_only: 1, update: 0, conflicts: 1 })
    )

    const taken = op(await plan(e, { take_markdown: [{ key: 'ABC-1', field: 'title' }] }), 'ABC-1')
    if (taken.kind !== 'update') throw new Error('esperava update')
    expect(taken.update.set).toEqual({ title: 'New md title' })
    expect(taken.record.field_hashes.title.app).toBe(sha('New md title'))
  })

  it('conflito mantido some até o md mudar de novo', async () => {
    const e = await imported()
    updateTask(e.d, { kind: 'user' }, e.id, { title: 'App title' })
    writeBrain(e.root, { [README]: md({ title: 'New md title' }) })
    applyForTest(e, await plan(e))
    appendFileSync(join(e.root, README), '\n')
    expect(row(await plan(e), 'ABC-1').conflicts).toEqual([])
    writeBrain(e.root, { [README]: md({ title: 'Third md title' }) })
    expect(row(await plan(e), 'ABC-1').conflicts.map((c) => c.field)).toEqual(['title'])
  })

  it('md igual e app editado: o app fica, sem conflito e sem mexer no hash', async () => {
    const e = await imported()
    const before = readRecord(e.db, 'ABC-1')!
    updateTask(e.d, { kind: 'user' }, e.id, { title: 'App title' })
    writeBrain(e.root, { [README]: md({ cps: ['2026-01-02 — a', '2026-01-03 — b'] }) })
    const p = await plan(e)
    expect(row(p, 'ABC-1')).toEqual(
      expect.objectContaining({ action: 'update', conflicts: [], fields: [] })
    )
    const u = op(p, 'ABC-1')
    if (u.kind !== 'update') throw new Error('esperava update')
    expect(u.update.set).toBeUndefined()
    expect(u.record.field_hashes.title).toEqual(before.field_hashes.title)
  })

  it('valor igual nos dois lados não é conflito', async () => {
    const e = await imported()
    updateTask(e.d, { kind: 'user' }, e.id, { title: 'Same title' })
    writeBrain(e.root, { [README]: md({ title: 'Same title' }) })
    const p = await plan(e)
    expect(row(p, 'ABC-1').conflicts).toEqual([])
    const u = op(p, 'ABC-1')
    expect(u.kind === 'update' && u.update.set).toBeUndefined()
  })

  it('links novos só acrescentam, sem conflito de descrição editada no app', async () => {
    const e = await imported()
    updateTask(e.d, { kind: 'user' }, e.id, { description: 'edited in app' })
    const before = readRecord(e.db, 'ABC-1')!
    writeBrain(e.root, { [README]: md({ mrs: [MR1] }) })
    const p = await plan(e)
    const u = op(p, 'ABC-1')
    if (u.kind !== 'update') throw new Error('esperava update')
    expect(u.update.append_links).toEqual([`- ${MR1}`])
    expect(u.update.set).toBeUndefined()
    expect(row(p, 'ABC-1')).toEqual(expect.objectContaining({ conflicts: [], new_links: 1 }))
    // a edição do usuário continua marcada como edição: o app do record não anda
    expect(u.record.field_hashes.description.app).toBe(before.field_hashes.description.app)
    expect(u.record.field_hashes.links).toEqual(['https://example.com/g/r/-/merge_requests/1'])

    // link já importado não volta
    applyForTest(e, p)
    appendFileSync(join(e.root, README), '\n')
    const again = op(await plan(e), 'ABC-1')
    expect(again.kind === 'update' && again.update.append_links).toBeUndefined()
  })

  it('links novos em descrição não editada recalculam o app (sem falso conflito depois)', async () => {
    const e = await imported()
    writeBrain(e.root, { [README]: md({ mrs: [MR1] }) })
    const p = await plan(e)
    applyForTest(e, p)
    const desc = (
      e.db.prepare('select description from task where id = ?').get(e.id) as {
        description: string
      }
    ).description
    expect(readRecord(e.db, 'ABC-1')!.field_hashes.description.app).toBe(sha(desc))
  })

  it('checkpoint já no banco não conta como novo', async () => {
    const e = await imported()
    writeBrain(e.root, { [README]: md({ cps: ['2026-01-02 — a ', '2026-01-03 — b'] }) })
    const p = await plan(e)
    expect(row(p, 'ABC-1').new_checkpoints).toBe(1)
    const u = op(p, 'ABC-1')
    expect(u.kind === 'update' && u.update.checkpoints).toEqual([
      { at: '2026-01-03T12:00:01.000Z', text: 'b' }
    ])
  })

  it('task apagada ou purgada no app = deleted_in_app', async () => {
    const e = await imported()
    e.db.prepare('update task set deleted_at = ? where id = ?').run(NOW, e.id)
    writeBrain(e.root, { [README]: md({ title: 'changed' }) })
    expect(row(await plan(e), 'ABC-1').action).toBe('deleted_in_app')
    e.db.prepare("update import_record set task_id = null, field_hashes = '{}'").run()
    const p = await plan(e)
    expect(row(p, 'ABC-1').action).toBe('deleted_in_app')
    expect(op(p, 'ABC-1')).toEqual({ kind: 'none', key: 'ABC-1' })
  })

  it('pasta sugerida só se a task está sem', async () => {
    const e = await imported()
    const p = await plan(e, { workdirs: { 'ABC-1': '/tmp/wt/ABC-1' } })
    const u = op(p, 'ABC-1')
    expect(u.kind === 'update' && u.update.workdir).toBe('/tmp/wt/ABC-1')
    expect(row(p, 'ABC-1')).toEqual(
      expect.objectContaining({ action: 'update', fields: ['workdir'] })
    )
    e.db.prepare("update task set workdir = '/tmp/mine' where id = ?").run(e.id)
    const q = await plan(e, { workdirs: { 'ABC-1': '/tmp/wt/ABC-1' } })
    expect(op(q, 'ABC-1')).toEqual({ kind: 'none', key: 'ABC-1' })
    // com o md mudado (merge), a pasta própria também fica
    writeBrain(e.root, { [README]: md({ title: 'New md title' }) })
    const m = op(await plan(e, { workdirs: { 'ABC-1': '/tmp/wt/ABC-1' } }), 'ABC-1')
    if (m.kind !== 'update') throw new Error('esperava update')
    expect(m.update.workdir).toBeUndefined()
  })

  it('token muda quando o banco muda o que o apply faria', async () => {
    const e = await imported()
    writeBrain(e.root, { [README]: md({ title: 'New md title' }) })
    const a = await plan(e)
    updateTask(e.d, { kind: 'user' }, e.id, { title: 'App title' })
    const b = await plan(e)
    expect(b.preview.token).not.toBe(a.preview.token)
  })
})

describe('aplicar', () => {
  const SECOND = '0b5e2c1a-1111-4aaa-8bbb-000000000002'
  const MR2 = 'repo => https://example.com/g/r/-/merge_requests/2'
  const README = 'tasks/current/ABC-1/README.md'
  const TABLES = [
    'task',
    'checkpoint',
    'ai_session',
    'activity',
    'project',
    'project_item',
    'import_record',
    'import_project',
    'key_seq'
  ]

  const three = (): Record<string, string> => ({
    'tasks/current/ABC-1/README.md': readme({
      key: 'ABC-1',
      title: 'Synthetic epic',
      status: 'in progress',
      body: 'Synthetic body.',
      mrs: [MR1],
      sessions: [`2026-01-01 — ${UUID1} — scope`],
      checkpoints: ['2026-01-02 — first step']
    }),
    'tasks/current/ABC-2/README.md': readme({
      key: 'ABC-2',
      status: 'weird status',
      parent: 'ABC-1'
    }),
    'tasks/done/ABC-3/README.md': readme({ key: 'ABC-3', status: 'weird status' })
  })

  /** Prévia + apply com o token que a prévia devolveu (o fluxo da tela). */
  async function run(e: Env, o: Partial<ImportOptions> = {}, fs?: BrainFs): Promise<ImportReport> {
    const opts = { status_map: EMPTY_MAP, ...o }
    const preview = await previewBrain(e.d, e.root, opts, fs)
    return applyBrain(e.d, e.root, opts, preview.token, fs)
  }

  const count = (db: Db, sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n
  const task = (e: Env, key: string): TaskDetail => getTask(e.d, key)

  const md = (o: { title?: string; body?: string; mrs?: string[]; cps?: string[] } = {}): string =>
    readme({
      key: 'ABC-1',
      title: o.title ?? 'First title',
      status: 'in progress',
      body: o.body,
      mrs: o.mrs,
      checkpoints: o.cps ?? ['2026-01-02 — a']
    })

  /** `data.links` da última Atividade `task_import` da task. */
  const activityLinks = (e: Env, key: string): number => {
    const r = e.db
      .prepare(
        `select data from activity where task_id = ? and op = 'task_import'
         order by id desc limit 1`
      )
      .get(task(e, key).id) as { data: string }
    return (JSON.parse(r.data) as { links: number }).links
  }

  async function single(): Promise<Env & { id: string }> {
    const e = setup({ [README]: md() })
    await run(e)
    return { ...e, id: task(e, 'ABC-1').id }
  }

  it('aplica e vira task', async () => {
    const e = setup(three())
    const inTx: boolean[] = []
    e.after.mockImplementation(() => inTx.push(e.db.inTransaction))
    const r = await run(e)
    // eventos só depois do commit, com as entidades que o apply tocou
    expect(inTx.length).toBeGreaterThan(0)
    expect(inTx.every((x) => !x)).toBe(true)
    const calls = e.after.mock.calls.map(([c]) => c)
    expect(new Set(calls.map((c) => c.entity))).toEqual(
      new Set(['task', 'project', 'session', 'flow', 'activity'])
    )
    const ids = ['ABC-1', 'ABC-2', 'ABC-3'].map((k) => task(e, k).id)
    expect(new Set(calls.filter((c) => c.entity === 'task').flatMap((c) => c.ids))).toEqual(
      new Set(ids)
    )
    expect(calls.find((c) => c.entity === 'project')!.ids).toEqual([task(e, 'ABC-1').project_id])
    expect(calls.filter((c) => c.entity === 'session').flatMap((c) => c.ids)).toEqual([
      task(e, 'ABC-1').sessions[0]!.id
    ])
    expect(activityLinks(e, 'ABC-1')).toBe(1)
    expect(activityLinks(e, 'ABC-2')).toBe(0)
    expect(r).toEqual(
      expect.objectContaining({ created: 3, updated: 0, unchanged: 0, projects_created: 1 })
    )
    const t = task(e, 'ABC-1')
    expect(t.title).toBe('Synthetic epic')
    expect(t.stage.name).toBe('Implementation')
    expect(t.description).toBe(
      'Synthetic body.\n\n## Links\n\n- repo => https://example.com/g/r/-/merge_requests/1'
    )
    expect(t.checkpoints).toEqual([
      expect.objectContaining({
        source: 'import',
        text: 'first step',
        at: expect.stringMatching(/^2026-01-02T/)
      })
    ])
    expect(t.sessions).toEqual([expect.objectContaining({ external_id: UUID1, label: 'scope' })])
    const done = task(e, 'ABC-3')
    expect(done.stage.id).toBe(e.ids.stages.Feature.at(-1))
    expect(done.stage.is_final).toBe(true)
    // ABC-1 traz 1; ABC-2 ganha o de status importado; ABC-3 em done/ já é mapeado pela pasta
    expect(r.checkpoints_added).toBe(2)
    expect(r.sessions_added).toBe(1)
    expect(r.links_added).toBe(1)
  })

  it('Status sem mapeamento', async () => {
    const e = setup(three())
    await run(e)
    const t = task(e, 'ABC-2')
    expect(t.stage.id).toBe(e.ids.stages.Feature[0])
    expect(t.checkpoints.map((c) => c.text)).toEqual(['Imported status: weird status'])
    // o mesmo status em done/ vai para a etapa final
    expect(task(e, 'ABC-3').stage.id).toBe(e.ids.stages.Feature.at(-1))
  })

  it('**Project:** vira chave com hash do nome (sem texto do markdown) e o reimport casa igual', async () => {
    const md = (key: string): string =>
      [
        '# ' + key + ' — T',
        '',
        '**Project:** Secret Épico',
        '',
        '## Description',
        '',
        'x',
        ''
      ].join('\n')
    const e = setup({
      'tasks/current/ABC-1/README.md': md('ABC-1'),
      'tasks/current/ABC-2/README.md': md('ABC-2')
    })
    const want = 'name:' + createHash('sha256').update('secret epico', 'utf8').digest('hex')
    const p = await plan(e)
    expect(p.projects.map((r) => r.source_key)).toEqual([want])
    expect(p.preview.projects[0]).toMatchObject({ source_key: want, name: 'Secret Épico' })
    await run(e)
    const rows = e.db.prepare('select source_key from import_project').all()
    expect(rows).toEqual([{ source_key: want }])
    expect(JSON.stringify(rows)).not.toMatch(/secret/i)
    // reimport com task nova no mesmo projeto: reconhece o projeto já importado
    writeBrain(e.root, { 'tasks/current/ABC-3/README.md': md('ABC-3') })
    const again = await plan(e)
    expect(again.preview.projects).toEqual([
      expect.objectContaining({ source_key: want, action: 'existing' })
    ])
  })

  it('Pai, Sessões, Checkpoints e MRs', async () => {
    const e = setup(three())
    await run(e)
    const a = task(e, 'ABC-1')
    const b = task(e, 'ABC-2')
    expect(b.project_id).not.toBeNull()
    expect(a.project_id).toBe(b.project_id)
    const p = e.db.prepare('select name from project where id = ?').get(b.project_id) as {
      name: string
    }
    expect(p.name).toBe('Synthetic epic')
    expect(listActivity(e.d, { task_id: b.id })[0]).toEqual(
      expect.objectContaining({ actor: 'import', op: 'task_import' })
    )
    expect(e.db.prepare('select source_key, project_id from import_project').all()).toEqual([
      { source_key: 'key:ABC-1', project_id: b.project_id }
    ])
    // o hash do app do projeto é o id que nasceu (não fica vazio)
    expect(readRecord(e.db, 'ABC-2')!.field_hashes.project.app).toBe(sha(b.project_id!))
  })

  it('projeto criado no apply: trocar o Pai depois é update sem conflito de projeto', async () => {
    const e = setup(three())
    await run(e)
    writeBrain(e.root, {
      'tasks/current/ABC-2/README.md': readme({
        key: 'ABC-2',
        status: 'weird status',
        parent: 'ABC-4'
      })
    })
    const preview = await previewBrain(e.d, e.root, { status_map: EMPTY_MAP })
    expect(preview.tasks.find((t) => t.key === 'ABC-2')).toEqual(
      expect.objectContaining({ action: 'update', fields: ['project'], conflicts: [] })
    )
    const r = await applyBrain(e.d, e.root, { status_map: EMPTY_MAP }, preview.token)
    expect(r.projects_created).toBe(1)
    const b = task(e, 'ABC-2')
    expect(b.project_id).not.toBe(task(e, 'ABC-1').project_id)
    expect(readRecord(e.db, 'ABC-2')!.field_hashes.project.app).toBe(sha(b.project_id!))
    // um Pai já importado é reusado, sem projeto novo
    writeBrain(e.root, {
      'tasks/current/ABC-5/README.md': readme({ key: 'ABC-5', parent: 'ABC-1' })
    })
    const again = await run(e)
    expect(again.projects_created).toBe(0)
    expect(task(e, 'ABC-5').project_id).toBe(task(e, 'ABC-1').project_id)
  })

  it('projeto apagado no app não volta: a task nova fica sem projeto', async () => {
    const e = setup(three())
    await run(e)
    const pid = task(e, 'ABC-1').project_id!
    deleteProject(e.d, { kind: 'user' }, { id: pid })
    writeBrain(e.root, {
      'tasks/current/ABC-5/README.md': readme({ key: 'ABC-5', parent: 'ABC-1' })
    })
    const r = await run(e)
    expect(r).toEqual(expect.objectContaining({ created: 1, projects_created: 0 }))
    expect(task(e, 'ABC-5').project_id).toBeNull()
    expect(count(e.db, 'select count(*) as n from project')).toBe(0)
  })

  it('reimport sem mudança = zero escritas', async () => {
    const e = setup(three())
    await run(e)
    const before = [
      totalChanges(e.db),
      e.after.mock.calls.length,
      count(e.db, 'select count(*) as n from activity')
    ]
    const r = await run(e)
    expect([
      totalChanges(e.db),
      e.after.mock.calls.length,
      count(e.db, 'select count(*) as n from activity')
    ]).toEqual(before)
    expect(r).toEqual(
      expect.objectContaining({ unchanged: 3, created: 0, updated: 0, record_only: 0 })
    )
  })

  it('conteúdo mudou sem mudar campo: só o record, contado em record_only', async () => {
    const e = await single()
    const activities = count(e.db, 'select count(*) as n from activity')
    appendFileSync(join(e.root, README), '\n\n')
    const r = await run(e)
    expect(r).toEqual(expect.objectContaining({ record_only: 1, updated: 0, unchanged: 0 }))
    expect(count(e.db, 'select count(*) as n from activity')).toBe(activities)
    expect((await previewBrain(e.d, e.root, { status_map: EMPTY_MAP })).counts.unchanged).toBe(1)
  })

  it('editado no app e mudado no md = conflito com o app mantido', async () => {
    const e = await single()
    updateTask(e.d, { kind: 'user' }, e.id, { title: 'app title' })
    writeBrain(e.root, { [README]: md({ title: 'md title' }) })
    const p = await previewBrain(e.d, e.root, { status_map: EMPTY_MAP })
    expect(p.tasks[0]!.conflicts.map((c) => c.field)).toEqual(['title'])
    const r = await applyBrain(e.d, e.root, { status_map: EMPTY_MAP }, p.token)
    expect(task(e, 'ABC-1').title).toBe('app title')
    expect(r.conflicts_kept).toEqual([{ key: 'ABC-1', field: 'title' }])
    expect(r.taken_markdown).toEqual([])
    const third = await previewBrain(e.d, e.root, { status_map: EMPTY_MAP })
    expect(third.tasks[0]!.conflicts).toEqual([])
  })

  it('escolher o markdown sobrescreve só aquele campo', async () => {
    const e = await single()
    updateTask(e.d, { kind: 'user' }, e.id, { title: 'app title', description: 'app body' })
    writeBrain(e.root, { [README]: md({ title: 'md title', body: 'md body' }) })
    const take = [{ key: 'ABC-1', field: 'title' as const }]
    const r = await run(e, { take_markdown: take })
    const t = task(e, 'ABC-1')
    expect(t.title).toBe('md title')
    expect(t.description).toBe('app body')
    expect(r.taken_markdown).toEqual(take)
    expect(r.conflicts_kept).toEqual([{ key: 'ABC-1', field: 'description' }])
  })

  it('mudou só no md, o md vence', async () => {
    const e = await single()
    writeBrain(e.root, { [README]: md({ title: 'md title' }) })
    const r = await run(e)
    expect(task(e, 'ABC-1').title).toBe('md title')
    expect(r).toEqual(expect.objectContaining({ updated: 1, conflicts_kept: [] }))
  })

  it('checkpoint não duplica com NFC e espaço', async () => {
    const e = setup({ [README]: md({ cps: ['2026-01-02 — café'] }) })
    await run(e)
    writeBrain(e.root, {
      [README]: md({ cps: ['2026-01-02 — café ', '2026-01-03 — next'] })
    })
    const r = await run(e)
    expect(r.checkpoints_added).toBe(1)
    expect(task(e, 'ABC-1').checkpoints.map((c) => c.text)).toEqual(['next', 'café'])
  })

  it('current→done move para a etapa final sem task nova', async () => {
    const e = await single()
    const tasks = taskCount(e.db)
    mkdirSync(join(e.root, 'tasks/done'), { recursive: true })
    renameSync(join(e.root, 'tasks/current/ABC-1'), join(e.root, 'tasks/done/ABC-1'))
    const p = await previewBrain(e.d, e.root, { status_map: EMPTY_MAP })
    expect(p.tasks[0]!.action).not.toBe('unchanged')
    await applyBrain(e.d, e.root, { status_map: EMPTY_MAP }, p.token)
    const t = task(e, 'ABC-1')
    expect(t.id).toBe(e.id)
    expect(t.stage.id).toBe(e.ids.stages.Feature.at(-1))
    const row = e.db.prepare('select done_at from task where id = ?').get(e.id) as {
      done_at: string | null
    }
    expect(row.done_at).not.toBeNull()
    // source_path relativo à pasta das tasks (ruling do Task 3)
    expect(readRecord(e.db, 'ABC-1')!.source_path).toBe('done/ABC-1/README.md')
    expect(taskCount(e.db)).toBe(tasks)
  })

  it('links só acrescentam', async () => {
    const e = await single()
    updateTask(e.d, { kind: 'user' }, e.id, { description: 'user edit' })
    writeBrain(e.root, { [README]: md({ mrs: [MR2] }) })
    const r = await run(e)
    expect(task(e, 'ABC-1').description).toBe(
      'user edit\n\n## Links\n\n- repo => https://example.com/g/r/-/merge_requests/2'
    )
    expect(r.conflicts_kept).toEqual([])
    expect(r.links_added).toBe(1)
    expect(activityLinks(e, 'ABC-1')).toBe(1)
  })

  it('md vence na descrição com link novo: a Atividade conta o link', async () => {
    const e = await single()
    writeBrain(e.root, { [README]: md({ body: 'new md body', mrs: [MR2] }) })
    const r = await run(e)
    expect(task(e, 'ABC-1').description).toBe(
      'new md body\n\n## Links\n\n- repo => https://example.com/g/r/-/merge_requests/2'
    )
    expect(r.links_added).toBe(1)
    expect(activityLinks(e, 'ABC-1')).toBe(1)
  })

  it('o plano é lido dentro da transação do apply', async () => {
    const e = setup(three())
    const plan = planImport(e.d, await scanBrain(e.root), { status_map: EMPTY_MAP })
    let inTx: boolean | null = null
    applyImport(
      e.d,
      () => {
        inTx = e.db.inTransaction
        return plan
      },
      plan.preview.token
    )
    expect(inTx).toBe(true)
    expect(taskCount(e.db)).toBe(3)
  })

  it('apagada não ressuscita', async () => {
    const e = await single()
    deleteTask(e.d, { kind: 'user' }, { id: e.id })
    const deletedAt = (
      e.db.prepare('select deleted_at from task where id = ?').get(e.id) as { deleted_at: string }
    ).deleted_at
    const cps = count(e.db, 'select count(*) as n from checkpoint where task_id = ?', e.id)
    writeBrain(e.root, { [README]: md({ title: 'md title', cps: ['2026-01-04 — new'] }) })
    const r = await run(e)
    expect(r.deleted_in_app).toContain('ABC-1')
    const row = e.db.prepare('select deleted_at, title from task where id = ?').get(e.id)
    expect(row).toEqual({ deleted_at: deletedAt, title: 'First title' })
    expect(count(e.db, 'select count(*) as n from checkpoint where task_id = ?', e.id)).toBe(cps)
  })

  it('purgada não ressuscita', async () => {
    const e = await single()
    purgeTask(e.db, e.id, e.d.tx)
    writeBrain(e.root, { [README]: md({ title: 'md title' }) })
    const r = await run(e)
    expect(r.deleted_in_app).toContain('ABC-1')
    expect(count(e.db, "select count(*) as n from task where key = 'ABC-1'")).toBe(0)
  })

  it('key T-n importada sobe o key_seq: purgada não é reaproveitada', async () => {
    const e = setup({ 'tasks/current/T-50/README.md': readme({ key: 'T-50' }) })
    await run(e)
    purgeTask(e.db, task(e, 'T-50').id, e.d.tx)
    expect(createTask(e.d, { kind: 'user' }, { title: 'next' }).row!.key).toBe('T-51')
  })

  it('key criada pelo sync vincula', async () => {
    const e = setup({
      'tasks/current/ABC-7/README.md': readme({
        key: 'ABC-7',
        title: 'Markdown title',
        sessions: [`2026-01-01 — ${SECOND} — scope`],
        checkpoints: ['2026-01-02 — note']
      })
    })
    const t = createTask(e.d, { kind: 'user' }, { title: 'App title' }).row!
    e.db.prepare("update task set key = 'ABC-7' where id = ?").run(t.id)
    const tasks = taskCount(e.db)
    const r = await run(e)
    expect(taskCount(e.db)).toBe(tasks)
    expect(r).toEqual(expect.objectContaining({ linked: 1, created: 0 }))
    const d = task(e, 'ABC-7')
    expect(d.title).toBe('App title')
    expect(d.checkpoints.map((c) => c.text)).toEqual(['note'])
    expect(d.sessions.map((s) => s.external_id)).toEqual([SECOND])
    expect(readRecord(e.db, 'ABC-7')!.task_id).toBe(t.id)
    expect(r.conflicts_kept).toContainEqual({ key: 'ABC-7', field: 'title' })
  })

  it('credentials/ nunca é lido como conteúdo de task', async () => {
    const secret = 'SYNTHETIC-SECRET-77c1d2'
    const e = setup({
      'credentials/service.md': `token: ${secret}`,
      'tasks/current/ABC-1/README.md': readme({ key: 'ABC-1' })
    })
    const readFile = vi.fn(nodeBrainFs.readFile)
    const fs: BrainFs = { ...nodeBrainFs, readFile }
    await run(e, {}, fs)
    expect(readFile).toHaveBeenCalled()
    for (const [p] of readFile.mock.calls) expect(p).not.toMatch(/credentials/)
    expect(JSON.stringify(dumpTables(e.db, TABLES))).not.toContain(secret)
  })

  it('falha no meio não deixa nada', async () => {
    const e = setup(three())
    const before = dumpTables(e.db, TABLES)
    const plan = planImport(e.d, await scanBrain(e.root), { status_map: EMPTY_MAP })
    const keys: string[] = []
    expect(() =>
      applyImport(e.d, () => plan, plan.preview.token, {
        afterTask: (key) => {
          keys.push(key)
          if (keys.length === 2) throw new Error('injected failure')
        }
      })
    ).toThrow('injected failure')
    expect(count(e.db, 'select count(*) as n from task')).toBe(0)
    expect(count(e.db, 'select count(*) as n from import_record')).toBe(0)
    expect(count(e.db, 'select count(*) as n from import_project')).toBe(0)
    expect(dumpTables(e.db, TABLES)).toEqual(before)
    expect(e.after).toHaveBeenCalledTimes(0)
  })

  it('arquivo mudou depois da prévia: CONFLICT preview_stale e banco idêntico', async () => {
    const e = setup(three())
    const p = await previewBrain(e.d, e.root, { status_map: EMPTY_MAP })
    writeBrain(e.root, {
      'tasks/current/ABC-2/README.md': readme({ key: 'ABC-2', title: 'edited after preview' })
    })
    const n = totalChanges(e.db)
    const err = await applyBrain(e.d, e.root, { status_map: EMPTY_MAP }, p.token).catch(
      (x: unknown) => x
    )
    expect(err).toBeInstanceOf(DomainError)
    expect(err).toEqual(
      expect.objectContaining({ code: 'CONFLICT', details: { reason: 'preview_stale' } })
    )
    expect(totalChanges(e.db)).toBe(n)
    expect(e.after).toHaveBeenCalledTimes(0)
  })

  it('origem byte a byte igual depois de prévia e apply', async () => {
    const e = setup({
      ...three(),
      'tasks/current/ABC-1/notes.txt': 'synthetic attachment',
      'credentials/service.md': 'token: synthetic'
    })
    const before = snapshot(e.root)
    await run(e)
    expect(snapshot(e.root)).toBe(before)
  })
})

/** sha256 de toda a árvore: path, tipo, conteúdo e mtime de cada entrada. */
function snapshot(root: string): string {
  const h = createHash('sha256')
  h.update(`${lstatSync(root).mtimeMs}\0`)
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      const st = lstatSync(p)
      h.update(`${relative(root, p)}\0${st.mode}\0${st.mtimeMs}\0`)
      if (st.isDirectory()) walk(p)
      else h.update(readFileSync(p))
    }
  }
  walk(root)
  return h.digest('hex')
}
