import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { VaultError } from '../../core/key/errors'
import type { Vault } from '../../core/key/vault'
import type { Db } from '../../core/db/open'
import type { DomainDeps } from '../../core/domain/context'
import { openTestDb, seedIds, tmpDir } from '../../core/testing/db'
import { readme, writeBrain } from '../../core/import/markdown/testing/brainFixture'
import type { ImportPreview, ImportReport, TaskRow } from '../../shared/contracts'
import type { Channel } from '../../shared/ipc/define'
import type { DomainChanged } from '../../shared/ipc/events'
import { CHANNELS } from '../../shared/ipc/registry'
import type { Result } from '../../shared/ipc/result'
import { DEFAULT_CONFIG, listThemes, readConfig, readThemesRaw, writeConfig } from '../appConfig'
import { handle, type Handler, type IpcLike } from './handle'
import { domainCache, registerDomainIpc } from './domain'
import { registerImportIpc } from './import'

const T0 = Date.parse('2026-10-22T12:00:00.000Z')

type Call = (method: keyof typeof CHANNELS, input?: unknown) => Promise<Result<unknown>>

type Env = {
  db: Db
  call: Call
  root: string
  legacy: string
  configDir: string
  mapFile: string
  afterCommit: ReturnType<typeof vi.fn<(c: DomainChanged) => void>>
  setBrainDir: ReturnType<typeof vi.fn<(dir: string) => Promise<void>>>
  pickFolder: ReturnType<typeof vi.fn<() => Promise<string | null>>>
  domains: DomainDeps[]
}

function setup(
  o: { vault?: Vault; files?: Record<string, string>; log?: (l: string) => void } = {}
): Env {
  const db = openTestDb()
  const vault = o.vault ?? ({ db: () => db } as unknown as Vault)
  const invokes = new Map<string, (...a: unknown[]) => unknown>()
  const ipc = {
    handle: (name: string, fn: (...a: never[]) => unknown) => void invokes.set(name, fn as never),
    on: () => undefined
  } as unknown as IpcLike
  const h = <C extends Channel>(ch: C, fn: Handler<C>): void =>
    handle(ipc, ch, fn, { validateOutput: true })
  const afterCommit = vi.fn<(c: DomainChanged) => void>()
  const cache = domainCache({
    now: () => new Date(T0),
    defaultWorkdir: () => null,
    afterCommit
  })
  // espia o que cada registro recebe: os dois têm que usar a mesma instância
  const domains: DomainDeps[] = []
  const domainFor = (d: Db): DomainDeps => {
    const x = cache(d)
    domains.push(x)
    return x
  }
  const configDir = tmpDir()
  const setBrainDir = vi.fn<(dir: string) => Promise<void>>(async () => undefined)
  const pickFolder = vi.fn<() => Promise<string | null>>(async () => null)
  registerDomainIpc(h, { vault, domainFor })
  // config e temas do app de verdade (em disco); a pasta do app legado é sintética
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(DEFAULT_CONFIG))
  mkdirSync(join(configDir, 'themes'))
  const legacy = tmpDir()
  registerImportIpc(h, {
    vault,
    domainFor,
    configDir,
    pickFolder,
    setBrainDir,
    legacyDir: () => legacy,
    writeConfig: async (patch) => void (await writeConfig(configDir, patch)),
    readThemesRaw: () => readThemesRaw(configDir),
    log: o.log
  })
  const root = tmpDir()
  writeBrain(root, o.files ?? {})
  const call: Call = async (method, input) => {
    const fn = invokes.get(CHANNELS[method].name)
    if (!fn) throw new Error(`sem handler: ${method}`)
    const args = input === undefined ? [] : [input]
    return (await fn({ sender: { id: 1 } }, ...args)) as Result<unknown>
  }
  return {
    db,
    call,
    root,
    legacy,
    configDir,
    mapFile: join(configDir, 'import-status-map.json'),
    afterCommit,
    setBrainDir,
    pickFolder,
    domains
  }
}

function data<T>(r: Result<unknown>): T {
  if (!r.ok) throw new Error(`esperava ok, veio ${r.error.code}: ${r.error.message}`)
  return r.data as T
}

const BRAIN = {
  'tasks/current/ABC-1/README.md': readme({ key: 'ABC-1', status: 'In progress' }),
  'tasks/current/ABC-2/README.md': readme({ key: 'ABC-2', status: 'weird status' })
}

const keys = (rows: TaskRow[]): string[] => rows.map((r) => r.key).sort()

describe('canais do import', () => {
  it('dryRun e apply pelo IPC', async () => {
    const e = setup({ files: BRAIN })
    const p = data<ImportPreview>(await e.call('importDryRun', { root: e.root }))
    expect(p.counts.create).toBe(2)
    const r = data<ImportReport>(await e.call('importApply', { root: e.root, token: p.token }))
    expect(r.created).toBe(2)
    const rows = data<TaskRow[]>(await e.call('taskList', { scope: 'attention' }))
    expect(keys(rows)).toEqual(['ABC-1', 'ABC-2'])
  })

  it('status_edits vale na prévia e fica salvo', async () => {
    const e = setup({ files: BRAIN })
    const status = (p: ImportPreview): ImportPreview['statuses'][number] =>
      p.statuses.find((s) => s.key === 'weird status')!
    const before = data<ImportPreview>(await e.call('importDryRun', { root: e.root }))
    expect(status(before)).toMatchObject({ target: null, source: 'none' })

    const edits = { 'weird status': { role: 'review' } }
    const p = data<ImportPreview>(
      await e.call('importDryRun', { root: e.root, status_edits: edits })
    )
    expect(status(p)).toMatchObject({ target: { role: 'review' } })
    data(await e.call('importApply', { root: e.root, status_edits: edits, token: p.token }))

    const review = e.db
      .prepare(
        'select id from flow_stage where flow_id = ? and waits_other = 1 and is_final = 0 order by position'
      )
      .get(p.flow_id) as { id: string }
    const rows = data<TaskRow[]>(await e.call('taskList', { scope: 'attention' }))
    expect(rows.find((r) => r.key === 'ABC-2')!.stage.id).toBe(review.id)

    expect(JSON.parse(readFileSync(e.mapFile, 'utf8'))).toEqual({
      version: 1,
      entries: { 'weird status': { role: 'review' } }
    })
    const again = data<ImportPreview>(await e.call('importDryRun', { root: e.root }))
    expect(status(again)).toMatchObject({ target: { role: 'review' }, source: 'saved' })
  })

  it('prévia não salva o mapa', async () => {
    const e = setup({ files: BRAIN })
    data(
      await e.call('importDryRun', {
        root: e.root,
        status_edits: { 'weird status': { role: 'review' } }
      })
    )
    expect(existsSync(e.mapFile)).toBe(false)
  })

  it('apply sem status_edits não reescreve o mapa salvo', async () => {
    const e = setup({ files: BRAIN })
    const raw = '{"version":1,"entries":{"weird status":{"role":"final"},"x":5}}'
    writeFileSync(e.mapFile, raw)
    const p = data<ImportPreview>(await e.call('importDryRun', { root: e.root }))
    expect(p.status_map).toEqual({ problem: null, dropped: 1 })
    data(await e.call('importApply', { root: e.root, token: p.token }))
    expect(readFileSync(e.mapFile, 'utf8')).toBe(raw)
    expect(existsSync(`${e.mapFile}.bak`)).toBe(false)
  })

  it('mapa de versão mais nova com status_edits é CONFLICT antes de importar', async () => {
    const e = setup({ files: BRAIN })
    writeFileSync(e.mapFile, '{"version":2,"entries":{}}')
    const edits = { 'weird status': { role: 'review' } }
    const p = data<ImportPreview>(
      await e.call('importDryRun', { root: e.root, status_edits: edits })
    )
    expect(p.status_map.problem).toBe('newer_version')
    expect(
      await e.call('importApply', { root: e.root, status_edits: edits, token: p.token })
    ).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', details: { reason: 'status_map_newer_version' } }
    })
    expect(data<TaskRow[]>(await e.call('taskList', { scope: 'attention' }))).toEqual([])
    expect(e.setBrainDir).not.toHaveBeenCalled()
  })

  it('root relativo é VALIDATION', async () => {
    const e = setup({ files: BRAIN })
    for (const r of [
      await e.call('importDryRun', { root: 'rel/brain' }),
      await e.call('importApply', { root: 'rel/brain', token: 'x' }),
      await e.call('importDryRun', { root: '' })
    ])
      expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })

  it('root sem tasks é VALIDATION com details.reason import_root_invalid', async () => {
    const e = setup({ files: { 'notes/a.md': 'x' } })
    expect(await e.call('importDryRun', { root: e.root })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', details: { reason: 'import_root_invalid' } }
    })
  })

  it('type_id que não existe é NOT_FOUND, não INTERNAL', async () => {
    const e = setup({ files: BRAIN })
    expect(await e.call('importDryRun', { root: e.root, type_id: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' }
    })
  })

  it('o tipo escolhido vale na prévia e no apply', async () => {
    const e = setup({ files: BRAIN })
    const ids = seedIds(e.db)
    const p = data<ImportPreview>(
      await e.call('importDryRun', { root: e.root, type_id: ids.types.Bugfix })
    )
    expect(p.flow_id).toBe(ids.flows.Bugfix)
    data(await e.call('importApply', { root: e.root, type_id: ids.types.Bugfix, token: p.token }))
    const rows = data<TaskRow[]>(await e.call('taskList', { scope: 'attention' }))
    expect(rows.map((r) => r.type_id)).toEqual([ids.types.Bugfix, ids.types.Bugfix])
  })

  it('token velho é CONFLICT preview_stale', async () => {
    const e = setup({ files: BRAIN })
    const p = data<ImportPreview>(await e.call('importDryRun', { root: e.root }))
    writeBrain(e.root, { 'tasks/current/ABC-3/README.md': readme({ key: 'ABC-3' }) })
    expect(await e.call('importApply', { root: e.root, token: p.token })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', details: { reason: 'preview_stale' } }
    })
    expect(e.setBrainDir).not.toHaveBeenCalled()
  })

  it('escolhas que mudam o plano entram na prévia: o token dela vale no apply', async () => {
    const e = setup({ files: BRAIN })
    const workdirs = { 'ABC-1': '/work/abc' }
    const plain = data<ImportPreview>(await e.call('importDryRun', { root: e.root }))
    const p = data<ImportPreview>(await e.call('importDryRun', { root: e.root, workdirs }))
    expect(p.token).not.toBe(plain.token)
    expect(
      await e.call('importApply', { root: e.root, workdirs, token: plain.token })
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    data(await e.call('importApply', { root: e.root, workdirs, token: p.token }))
  })

  it('locked devolve LOCKED', async () => {
    const vault = {
      db: () => {
        throw new VaultError('LOCKED')
      }
    } as unknown as Vault
    const e = setup({ vault, files: BRAIN })
    for (const r of [
      await e.call('importDryRun', { root: e.root }),
      await e.call('importApply', { root: e.root, token: 'x' })
    ])
      expect(r).toMatchObject({ ok: false, error: { code: 'LOCKED' } })
  })

  it('apply grava brainDir', async () => {
    const e = setup({ files: BRAIN })
    const p = data<ImportPreview>(await e.call('importDryRun', { root: e.root }))
    expect(e.setBrainDir).not.toHaveBeenCalled()
    data(await e.call('importApply', { root: e.root, token: p.token }))
    expect(e.setBrainDir).toHaveBeenCalledWith(e.root)
  })

  it('falha ao gravar brainDir depois do commit não vira erro do import', async () => {
    const log = vi.fn()
    const e = setup({ files: BRAIN, log })
    e.setBrainDir.mockRejectedValueOnce(new Error('config.json quebrado'))
    const p = data<ImportPreview>(await e.call('importDryRun', { root: e.root }))
    expect(
      data<ImportReport>(await e.call('importApply', { root: e.root, token: p.token }))
    ).toMatchObject({ created: 2, warnings: ['brain_dir_not_saved'] })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('config.json quebrado'))
  })

  it('falha ao gravar o mapa depois do commit vira aviso no relatório', async () => {
    const log = vi.fn()
    const e = setup({ files: BRAIN, log })
    mkdirSync(e.mapFile) // rename do arquivo temporário sobre uma pasta falha
    const edits = { 'weird status': { role: 'review' } }
    const p = data<ImportPreview>(
      await e.call('importDryRun', { root: e.root, status_edits: edits })
    )
    expect(
      data<ImportReport>(
        await e.call('importApply', { root: e.root, status_edits: edits, token: p.token })
      )
    ).toMatchObject({ created: 2, warnings: ['status_map_not_saved'] })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('status map not saved'))
    expect(e.setBrainDir).toHaveBeenCalledWith(e.root)
  })

  it('apply sem falha não tem aviso', async () => {
    const e = setup({ files: BRAIN })
    const p = data<ImportPreview>(await e.call('importDryRun', { root: e.root }))
    expect(
      data<ImportReport>(await e.call('importApply', { root: e.root, token: p.token })).warnings
    ).toEqual([])
  })

  it('pickFolder devolve o que o diálogo escolheu ou null', async () => {
    const e = setup()
    expect(data(await e.call('importPickFolder'))).toEqual({ path: null })
    e.pickFolder.mockResolvedValueOnce('/some/brain')
    expect(data(await e.call('importPickFolder'))).toEqual({ path: '/some/brain' })
  })

  it('workdirs vazio ou relativo é VALIDATION', async () => {
    const e = setup({ files: BRAIN })
    for (const workdirs of [{ 'ABC-1': '' }, { 'ABC-1': 'rel' }]) {
      expect(await e.call('importApply', { root: e.root, token: 'x', workdirs })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' }
      })
      expect(await e.call('importDryRun', { root: e.root, workdirs })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' }
      })
    }
  })

  it('um domainFor só', async () => {
    const e = setup({ files: BRAIN })
    data(await e.call('taskList', { scope: 'attention' }))
    const p = data<ImportPreview>(await e.call('importDryRun', { root: e.root }))
    data(await e.call('importApply', { root: e.root, token: p.token }))
    // a mesma instância de DomainDeps atende o domínio e o import
    expect(e.domains.length).toBeGreaterThanOrEqual(3)
    expect(new Set(e.domains).size).toBe(1)
    // e os eventos do import saem pelo mesmo afterCommit
    expect(e.afterCommit).toHaveBeenCalled()
    const ids = e.afterCommit.mock.calls.flatMap(([c]) => (c.entity === 'task' ? c.ids : []))
    const rows = data<TaskRow[]>(await e.call('taskList', { scope: 'attention' }))
    for (const r of rows) expect(ids).toContain(r.id)
  })

  describe('app legado', () => {
    const seedLegacy = (dir: string): void => {
      mkdirSync(join(dir, 'themes'), { recursive: true })
      writeFileSync(
        join(dir, 'config.json'),
        JSON.stringify({ theme: 'night', termFont: 'Fira Code', zoom: 2 })
      )
      writeFileSync(
        join(dir, 'themes', 'night.json'),
        JSON.stringify({ name: 'Night', ui: { bg: '#0a0a14', accent: '#ff00aa' }, terminal: {} })
      )
    }
    type Plan = { token: string; themes: { action: string; to: string | null }[]; config: object }
    type Result = { themes_created: number; config_keys: string[]; skipped: string[] }

    it('legacy dry-run e apply pelo IPC', async () => {
      const e = setup()
      seedLegacy(e.legacy)
      const p = data<Plan>(await e.call('importLegacyDryRun'))
      expect(p.themes).toEqual([expect.objectContaining({ action: 'create', to: 'night' })])
      expect(p.config).toEqual({ theme: 'night', termFont: 'Fira Code' })
      const r = data<Result>(await e.call('importLegacyApply', { token: p.token }))
      expect(r).toEqual({ themes_created: 1, config_keys: ['theme', 'termFont'], skipped: [] })
      const cfg = (await readConfig(e.configDir)).config
      expect(cfg).toMatchObject({ theme: 'night', termFont: 'Fira Code' })
    })

    it('tema legado aparece em Ajustes → Tema', async () => {
      const e = setup()
      seedLegacy(e.legacy)
      const p = data<Plan>(await e.call('importLegacyDryRun'))
      data(await e.call('importLegacyApply', { token: p.token }))
      expect(await listThemes(e.configDir)).toContainEqual({ id: 'night', name: 'Night' })
    })

    it('segundo apply legado não cria arquivo', async () => {
      const e = setup()
      seedLegacy(e.legacy)
      const p = data<Plan>(await e.call('importLegacyDryRun'))
      data(await e.call('importLegacyApply', { token: p.token }))
      const before = readdirSync(join(e.configDir, 'themes')).sort()
      const p2 = data<Plan>(await e.call('importLegacyDryRun'))
      expect(p2.themes.map((t) => t.action)).toEqual(['skip_same'])
      expect(p2.config).toEqual({})
      const r = data<Result>(await e.call('importLegacyApply', { token: p2.token }))
      expect(r.themes_created).toBe(0)
      expect(readdirSync(join(e.configDir, 'themes')).sort()).toEqual(before)
    })

    it('config.json do app inválido: falha antes de escrever qualquer coisa', async () => {
      const e = setup()
      seedLegacy(e.legacy)
      writeFileSync(join(e.configDir, 'config.json'), '{ nope')
      for (const call of [
        () => e.call('importLegacyDryRun'),
        () => e.call('importLegacyApply', { token: 'x' })
      ])
        expect(await call()).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      expect(readdirSync(join(e.configDir, 'themes'))).toEqual([])
      expect(readFileSync(join(e.configDir, 'config.json'), 'utf8')).toBe('{ nope')
    })

    it('token velho é preview_stale e origem ausente é NOT_FOUND', async () => {
      const e = setup()
      rmSync(e.legacy, { recursive: true })
      expect(await e.call('importLegacyDryRun')).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' }
      })
      mkdirSync(e.legacy)
      seedLegacy(e.legacy)
      expect(await e.call('importLegacyApply', { token: 'velho' })).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT' }
      })
      expect(readdirSync(join(e.configDir, 'themes'))).toEqual([])
    })
  })
})
