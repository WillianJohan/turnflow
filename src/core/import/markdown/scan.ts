import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { importError } from '../errors'

export type BrainDirent = {
  name: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/** Única porta de E/S do scan: só leitura. `stat` não segue symlink. */
export type BrainFs = {
  readdir(p: string): Promise<BrainDirent[]>
  readFile(p: string): Promise<Buffer>
  stat(p: string): Promise<{ size: number; mtimeMs: number }>
}

export const nodeBrainFs: BrainFs = {
  readdir: (p) => readdir(p, { withFileTypes: true }),
  readFile: (p) => readFile(p),
  stat: (p) => lstat(p)
}

export type BrainDir = 'current' | 'backlog' | 'done'
export type PendingAttachment = { key: string; name: string; path: string; size: number }
export type IgnoredReason =
  'credentials' | 'symlink' | 'too_large' | 'not_a_key' | 'no_readme' | 'duplicate' | 'unreadable'
export type Ignored = { path: string; reason: IgnoredReason }
export type ScannedTask = {
  key: string
  dir: BrainDir
  /** Relativo à raiz escaneada, com `/`. */
  source_path: string
  text: string
  file_hash: string
  mtime: string
  attachments: PendingAttachment[]
}
export type BrainScan = { root: string; tasks: ScannedTask[]; ignored: Ignored[] }

export const KEY_RE = /^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/
export const MAX_README_BYTES = 1_048_576
export const MAX_TASKS = 5_000

/** Ordem de precedência na duplicata (Decisão 20) e de saída. */
const DIRS: readonly BrainDir[] = ['current', 'backlog', 'done']
const README = 'README.md'

const isCredentials = (name: string): boolean => name.toLowerCase() === 'credentials'
const rel = (...parts: string[]): string => parts.filter(Boolean).join('/')

/**
 * Lê a pasta do brain sem escrever nada, sem seguir symlink e sem NUNCA abrir `credentials`
 * (só lista nomes). Tudo que fica de fora volta em `ignored` com o motivo.
 */
export async function scanBrain(
  root: string,
  fs: BrainFs = nodeBrainFs,
  maxTasks: number = MAX_TASKS
): Promise<BrainScan> {
  if (!isAbsolute(root)) throw importError('VALIDATION', 'import_root_invalid')
  const ignored: Ignored[] = []
  const base = await findTasksBase(root, fs)
  if (base === null) throw importError('VALIDATION', 'import_root_invalid')

  // credentials na raiz escaneada: só nomes.
  const top = await listDir(fs, root)
  for (const e of top ?? [])
    if (isCredentials(e.name)) await listCredentials(fs, root, e.name, e, ignored)

  const tasksAbs = join(root, base)
  const tasksRel = base
  const tasks: ScannedTask[] = []
  const seen = new Set<string>()
  const entries = base === '' ? top : await listDir(fs, tasksAbs)
  for (const dir of DIRS) {
    const d = (entries ?? []).find((e) => e.name === dir)
    if (!d) continue
    const dirRel = rel(tasksRel, dir)
    if (d.isSymbolicLink()) {
      ignored.push({ path: dirRel, reason: 'symlink' })
      continue
    }
    if (!d.isDirectory()) continue
    const folders = await listDir(fs, join(tasksAbs, dir))
    if (folders === null) {
      ignored.push({ path: dirRel, reason: 'unreadable' })
      continue
    }
    for (const f of [...folders].sort((a, b) => cmp(a.name, b.name))) {
      const folderRel = rel(dirRel, f.name)
      if (isCredentials(f.name)) {
        await listCredentials(fs, join(tasksAbs, dir), f.name, f, ignored, dirRel)
      } else if (f.isSymbolicLink()) {
        ignored.push({ path: folderRel, reason: 'symlink' })
      } else if (!f.isDirectory()) {
        // arquivo solto na pasta de estado: não é task.
      } else if (!KEY_RE.test(f.name)) {
        ignored.push({ path: folderRel, reason: 'not_a_key' })
      } else if (seen.has(f.name)) {
        ignored.push({ path: folderRel, reason: 'duplicate' })
      } else {
        const t = await scanTask(fs, join(tasksAbs, dir, f.name), folderRel, f.name, dir, ignored)
        if (t) {
          seen.add(f.name)
          tasks.push(t)
          if (tasks.length > maxTasks) throw importError('VALIDATION', 'too_many_tasks')
        }
      }
    }
  }
  return { root, tasks, ignored }
}

/** '' se a raiz já é `tasks/`, 'tasks' se é o brain, null se não tem nenhuma pasta de estado. */
async function findTasksBase(root: string, fs: BrainFs): Promise<'' | 'tasks' | null> {
  const hasState = (es: BrainDirent[] | null): boolean =>
    (es ?? []).some((e) => DIRS.includes(e.name as BrainDir) && e.isDirectory())
  const top = await listDir(fs, root)
  if (hasState(top)) return ''
  const t = (top ?? []).find((e) => e.name === 'tasks')
  if (t?.isDirectory() && hasState(await listDir(fs, join(root, 'tasks')))) return 'tasks'
  return null
}

async function scanTask(
  fs: BrainFs,
  abs: string,
  folderRel: string,
  key: string,
  dir: BrainDir,
  ignored: Ignored[]
): Promise<ScannedTask | null> {
  const files = await listDir(fs, abs)
  if (files === null) {
    ignored.push({ path: folderRel, reason: 'unreadable' })
    return null
  }
  const readmeEntry = files.find((e) => e.name === README)
  const readmeRel = rel(folderRel, README)
  if (!readmeEntry) {
    ignored.push({ path: folderRel, reason: 'no_readme' })
    return null
  }
  if (readmeEntry.isSymbolicLink()) {
    ignored.push({ path: readmeRel, reason: 'symlink' })
    return null
  }
  if (!readmeEntry.isFile()) {
    ignored.push({ path: folderRel, reason: 'no_readme' })
    return null
  }
  const readmeAbs = join(abs, README)
  try {
    const st = await fs.stat(readmeAbs)
    if (st.size > MAX_README_BYTES) {
      ignored.push({ path: readmeRel, reason: 'too_large' })
      return null
    }
    const buf = await fs.readFile(readmeAbs)
    const attachments: PendingAttachment[] = []
    await collectAttachments(fs, abs, '', key, folderRel, attachments, ignored, true)
    return {
      key,
      dir,
      source_path: readmeRel,
      text: buf.toString('utf8'),
      file_hash: createHash('sha256').update(buf).digest('hex'),
      mtime: new Date(st.mtimeMs).toISOString(),
      attachments
    }
  } catch {
    ignored.push({ path: readmeRel, reason: 'unreadable' })
    return null
  }
}

/** Anexo = arquivo da pasta da task, recursivo, sem o README da raiz da task. Nunca lê o conteúdo. */
async function collectAttachments(
  fs: BrainFs,
  abs: string,
  within: string,
  key: string,
  folderRel: string,
  out: PendingAttachment[],
  ignored: Ignored[],
  isTaskRoot: boolean
): Promise<void> {
  const here = within ? join(abs, within) : abs
  const entries = await listDir(fs, here)
  if (entries === null) {
    ignored.push({ path: rel(folderRel, within), reason: 'unreadable' })
    return
  }
  for (const e of [...entries].sort((a, b) => cmp(a.name, b.name))) {
    const name = rel(within, e.name)
    const eRel = rel(folderRel, name)
    if (isCredentials(e.name)) {
      await listCredentials(fs, here, e.name, e, ignored, rel(folderRel, within))
    } else if (e.isSymbolicLink()) {
      ignored.push({ path: eRel, reason: 'symlink' })
    } else if (e.isDirectory()) {
      await collectAttachments(fs, abs, name, key, folderRel, out, ignored, false)
    } else if (e.isFile()) {
      if (isTaskRoot && e.name === README) continue
      try {
        const st = await fs.stat(join(here, e.name))
        out.push({ key, name, path: join(here, e.name), size: st.size })
      } catch {
        ignored.push({ path: eRel, reason: 'unreadable' })
      }
    }
  }
}

/**
 * Registra tudo sob `credentials` em `ignored`. Só `readdir` (nomes): nenhum arquivo é aberto
 * e nenhum symlink é seguido. Pasta que não lista vira uma entrada só.
 */
async function listCredentials(
  fs: BrainFs,
  parentAbs: string,
  name: string,
  entry: BrainDirent,
  ignored: Ignored[],
  parentRel = ''
): Promise<void> {
  const r = rel(parentRel, name)
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    ignored.push({ path: r, reason: 'credentials' })
    return
  }
  const children = await listDir(fs, join(parentAbs, name))
  if (children === null) {
    ignored.push({ path: r, reason: 'credentials' })
    return
  }
  for (const c of [...children].sort((a, b) => cmp(a.name, b.name)))
    await listCredentials(fs, join(parentAbs, name), c.name, c, ignored, r)
}

async function listDir(fs: BrainFs, p: string): Promise<BrainDirent[] | null> {
  try {
    return await fs.readdir(p)
  } catch {
    return null
  }
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
