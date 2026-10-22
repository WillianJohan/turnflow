import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
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
  /** Lê no máximo `maxBytes` (se vier) e nunca segue symlink. */
  readFile(p: string, maxBytes?: number): Promise<Buffer>
  stat(p: string): Promise<{ size: number; mtimeMs: number }>
}

export const nodeBrainFs: BrainFs = {
  readdir: (p) => readdir(p, { withFileTypes: true }),
  readFile: async (p, maxBytes) => {
    // NOFOLLOW: se o README virou symlink depois do readdir, falha (ELOOP) em vez de seguir.
    // No Windows a constante não existe: sobra só o filtro isSymbolicLink do readdir.
    const h = await open(p, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const size = (await h.stat()).size
      const cap = maxBytes === undefined ? size : Math.min(size, maxBytes)
      const buf = Buffer.alloc(cap)
      const { bytesRead } = await h.read(buf, 0, cap, 0)
      return buf.subarray(0, bytesRead)
    } finally {
      await h.close()
    }
  },
  stat: (p) => lstat(p)
}

export type BrainDir = 'current' | 'backlog' | 'done'
export type PendingAttachment = { key: string; name: string; path: string; size: number }
export type IgnoredReason =
  | 'credentials'
  | 'symlink'
  | 'too_large'
  | 'not_a_key'
  | 'no_readme'
  | 'duplicate'
  | 'unreadable'
  | 'loose_file'
  | 'skipped_dir'
  | 'truncated'
/** `path` é relativo à raiz escolhida. `count` só existe em `truncated`: quantos itens foram agregados. */
export type Ignored = { path: string; reason: IgnoredReason; count?: number }
export type ScannedTask = {
  key: string
  dir: BrainDir
  /** Relativo à pasta das tasks (`current/ABC-1/README.md`), com `/`, seja qual for a raiz escolhida. */
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

export type ScanLimits = {
  maxTasks: number
  maxAttachmentsPerTask: number
  maxAttachmentsTotal: number
  /** Teto de `ignored`; o excedente vira uma entrada `truncated`. */
  maxIgnored: number
  /** Soma dos READMEs lidos; estourou = `VALIDATION too_large`. */
  maxTotalReadBytes: number
}
export const DEFAULT_LIMITS: ScanLimits = {
  maxTasks: MAX_TASKS,
  maxAttachmentsPerTask: 10_000,
  maxAttachmentsTotal: 50_000,
  maxIgnored: 10_000,
  maxTotalReadBytes: 256 * 1024 * 1024
}

/** Ordem de precedência na duplicata (Decisão 20) e de saída. */
const DIRS: readonly BrainDir[] = ['current', 'backlog', 'done']
const README = 'README.md'

/** `credentials*` e `.credentials*`, em qualquer caixa: nunca aberto, nunca anexo. */
const isCredentials = (name: string): boolean => /^\.?credentials/i.test(name)
/** Pasta que nunca vale descer: ponto (`.git`) e `node_modules`. */
const isSkippedDir = (name: string): boolean => name.startsWith('.') || name === 'node_modules'
const rel = (...parts: string[]): string => parts.filter(Boolean).join('/')
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const sorted = (es: BrainDirent[]): BrainDirent[] => [...es].sort((a, b) => cmp(a.name, b.name))

type Ctx = {
  fs: BrainFs
  limits: ScanLimits
  ignored: Ignored[]
  ignoredOmitted: number
  attachmentsTotal: number
  readBytes: number
}

function ignore(c: Ctx, i: Ignored): void {
  if (c.ignored.length < c.limits.maxIgnored) c.ignored.push(i)
  else c.ignoredOmitted++
}

/**
 * Lê a pasta do brain sem escrever nada, sem seguir symlink e sem NUNCA abrir `credentials`
 * (só lista nomes). Tudo que fica de fora volta em `ignored` com o motivo.
 *
 * `root` é a raiz do brain (com `tasks/`) ou a própria `tasks/`. Se o próprio `root` é um symlink,
 * é aceito: foi escolha explícita do usuário. Symlink DENTRO da raiz nunca é seguido.
 */
export async function scanBrain(
  root: string,
  fs: BrainFs = nodeBrainFs,
  limits: Partial<ScanLimits> = {}
): Promise<BrainScan> {
  if (!isAbsolute(root)) throw importError('VALIDATION', 'import_root_invalid')
  const c: Ctx = {
    fs,
    limits: { ...DEFAULT_LIMITS, ...limits },
    ignored: [],
    ignoredOmitted: 0,
    attachmentsTotal: 0,
    readBytes: 0
  }
  const top = await listDir(fs, root)
  if (top === null) throw importError('VALIDATION', 'import_root_invalid')
  const isState = (e: BrainDirent): boolean => DIRS.includes(e.name as BrainDir)
  const hasState = (es: BrainDirent[]): boolean =>
    es.some((e) => isState(e) && (e.isDirectory() || e.isSymbolicLink()))

  let base = ''
  let entries = top
  if (!hasState(top)) {
    const t = top.find((e) => e.name === 'tasks')
    if (t?.isSymbolicLink()) {
      ignore(c, { path: 'tasks', reason: 'symlink' })
      for (const e of top) if (isCredentials(e.name)) await listCredentials(c, root, e, '')
      return finish(c, root, [])
    }
    const inner = t?.isDirectory() ? await listDir(fs, join(root, 'tasks')) : null
    if (!inner || !hasState(inner)) throw importError('VALIDATION', 'import_root_invalid')
    base = 'tasks'
    entries = inner
    for (const e of top) if (isCredentials(e.name)) await listCredentials(c, root, e, '')
  }
  const tasksAbs = join(root, base)
  for (const e of entries) if (isCredentials(e.name)) await listCredentials(c, tasksAbs, e, base)

  const tasks: ScannedTask[] = []
  const seen = new Set<string>()
  for (const dir of DIRS) {
    const d = entries.find((e) => e.name === dir)
    if (!d) continue
    const dirRel = rel(base, dir)
    if (d.isSymbolicLink()) {
      ignore(c, { path: dirRel, reason: 'symlink' })
      continue
    }
    if (!d.isDirectory()) continue
    const folders = await listDir(fs, join(tasksAbs, dir))
    if (folders === null) {
      ignore(c, { path: dirRel, reason: 'unreadable' })
      continue
    }
    for (const f of sorted(folders)) {
      const folderRel = rel(dirRel, f.name)
      if (isCredentials(f.name)) {
        await listCredentials(c, join(tasksAbs, dir), f, dirRel)
      } else if (f.isSymbolicLink()) {
        ignore(c, { path: folderRel, reason: 'symlink' })
      } else if (!f.isDirectory()) {
        ignore(c, { path: folderRel, reason: 'loose_file' })
      } else if (!KEY_RE.test(f.name)) {
        ignore(c, { path: folderRel, reason: 'not_a_key' })
      } else if (seen.has(f.name)) {
        ignore(c, { path: folderRel, reason: 'duplicate' })
      } else {
        const t = await scanTask(c, join(tasksAbs, dir, f.name), folderRel, rel(dir, f.name), dir)
        if (t) {
          seen.add(f.name)
          tasks.push(t)
          if (tasks.length > c.limits.maxTasks) throw importError('VALIDATION', 'too_many_tasks')
        }
      }
    }
  }
  return finish(c, root, tasks)
}

function finish(c: Ctx, root: string, tasks: ScannedTask[]): BrainScan {
  if (c.ignoredOmitted > 0)
    c.ignored.push({ path: '.', reason: 'truncated', count: c.ignoredOmitted })
  return { root, tasks, ignored: c.ignored }
}

async function scanTask(
  c: Ctx,
  abs: string,
  folderRel: string,
  taskRel: string,
  dir: BrainDir
): Promise<ScannedTask | null> {
  const key = taskRel.split('/')[1]!
  const files = await listDir(c.fs, abs)
  if (files === null) {
    ignore(c, { path: folderRel, reason: 'unreadable' })
    return null
  }
  const entry = files.find((e) => e.name === README)
  const readmeRel = rel(folderRel, README)
  if (!entry || (!entry.isFile() && !entry.isSymbolicLink())) {
    ignore(c, { path: folderRel, reason: 'no_readme' })
    return null
  }
  if (entry.isSymbolicLink()) {
    ignore(c, { path: readmeRel, reason: 'symlink' })
    return null
  }
  const readmeAbs = join(abs, README)
  try {
    const st = await c.fs.stat(readmeAbs)
    if (st.size > MAX_README_BYTES) {
      ignore(c, { path: readmeRel, reason: 'too_large' })
      return null
    }
    // O stat pode estar velho: lê no máximo teto + 1 byte e confere de novo.
    const buf = await c.fs.readFile(readmeAbs, MAX_README_BYTES + 1)
    if (buf.length > MAX_README_BYTES) {
      ignore(c, { path: readmeRel, reason: 'too_large' })
      return null
    }
    c.readBytes += buf.length
    if (c.readBytes > c.limits.maxTotalReadBytes) throw importError('VALIDATION', 'too_large')
    const attachments: PendingAttachment[] = []
    const omitted = await collectAttachments(c, abs, '', key, folderRel, attachments)
    if (omitted > 0) ignore(c, { path: folderRel, reason: 'truncated', count: omitted })
    return {
      key,
      dir,
      source_path: rel(taskRel, README),
      text: buf.toString('utf8'),
      file_hash: createHash('sha256').update(buf).digest('hex'),
      mtime: new Date(st.mtimeMs).toISOString(),
      attachments
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'DomainError') throw e
    ignore(c, { path: readmeRel, reason: 'unreadable' })
    return null
  }
}

/**
 * Anexo = arquivo da pasta da task, recursivo, sem o README da raiz da task. Nunca lê o conteúdo.
 * Devolve quantos passaram do teto (por task ou total) e não entraram em `out`.
 */
async function collectAttachments(
  c: Ctx,
  abs: string,
  within: string,
  key: string,
  folderRel: string,
  out: PendingAttachment[]
): Promise<number> {
  const here = within ? join(abs, within) : abs
  const entries = await listDir(c.fs, here)
  if (entries === null) {
    ignore(c, { path: rel(folderRel, within), reason: 'unreadable' })
    return 0
  }
  let omitted = 0
  for (const e of sorted(entries)) {
    const name = rel(within, e.name)
    const eRel = rel(folderRel, name)
    if (isCredentials(e.name)) {
      await listCredentials(c, here, e, rel(folderRel, within))
    } else if (e.isSymbolicLink()) {
      ignore(c, { path: eRel, reason: 'symlink' })
    } else if (e.isDirectory()) {
      if (isSkippedDir(e.name)) ignore(c, { path: eRel, reason: 'skipped_dir' })
      else omitted += await collectAttachments(c, abs, name, key, folderRel, out)
    } else if (e.isFile()) {
      if (within === '' && e.name === README) continue
      if (
        out.length >= c.limits.maxAttachmentsPerTask ||
        c.attachmentsTotal >= c.limits.maxAttachmentsTotal
      ) {
        omitted++
        continue
      }
      try {
        const st = await c.fs.stat(join(here, e.name))
        out.push({ key, name, path: join(here, e.name), size: st.size })
        c.attachmentsTotal++
      } catch {
        ignore(c, { path: eRel, reason: 'unreadable' })
      }
    }
  }
  return omitted
}

/**
 * Registra tudo sob `credentials` em `ignored`. Só `readdir` (nomes): nenhum arquivo é aberto
 * e nenhum symlink é seguido. Pasta que não lista vira uma entrada só.
 */
async function listCredentials(
  c: Ctx,
  parentAbs: string,
  entry: BrainDirent,
  parentRel: string
): Promise<void> {
  const r = rel(parentRel, entry.name)
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    ignore(c, { path: r, reason: 'credentials' })
    return
  }
  const children = await listDir(c.fs, join(parentAbs, entry.name))
  if (children === null) {
    ignore(c, { path: r, reason: 'credentials' })
    return
  }
  for (const ch of sorted(children)) await listCredentials(c, join(parentAbs, entry.name), ch, r)
}

async function listDir(fs: BrainFs, p: string): Promise<BrainDirent[] | null> {
  try {
    return await fs.readdir(p)
  } catch {
    return null
  }
}
