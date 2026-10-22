import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BRAND } from '../../shared/brand'
import { isAbsolutePath } from '../../shared/pathSyntax'
import type { DomainDeps } from '../domain/context'
import { getTask, listTasks } from '../domain/rows'
import { importError } from '../import/errors'
import { renderReadme, safeDirName, type ExportTask } from './render'

/** Única porta de E/S do export. */
export type ExportFs = {
  mkdir(p: string): Promise<void>
  writeFile(p: string, data: string): Promise<void>
  rename(a: string, b: string): Promise<void>
  rm(p: string): Promise<void>
}

// Pasta e arquivos só do dono: é o conteúdo inteiro do banco em texto claro.
export const nodeExportFs: ExportFs = {
  mkdir: async (p) => void (await mkdir(p, { recursive: true, mode: 0o700 })),
  // `wx`: nunca sobrescreve
  writeFile: (p, data) => writeFile(p, data, { mode: 0o600, flag: 'wx' }),
  rename,
  rm: (p) => rm(p, { recursive: true, force: true })
}

const isDir = (p: string): Promise<boolean> =>
  stat(p).then(
    (s) => s.isDirectory(),
    () => false
  )
const exists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false
  )

/** Lê tudo de uma vez (síncrono: um retrato só do banco), vivas e concluídas, nunca as apagadas. */
function collect(d: DomainDeps): { live: ExportTask[]; done: ExportTask[] } {
  const typeName = d.db.prepare('select name from task_type where id = ?')
  const projectName = d.db.prepare('select name from project where id = ?')
  const one = (ids: { id: string }[]): ExportTask[] =>
    ids
      .map(({ id }) => {
        const t = getTask(d, id)
        return {
          key: t.key,
          title: t.title,
          stage: t.stage.name,
          blocked_reason: t.blocked_reason,
          project:
            t.project_id === null
              ? null
              : ((projectName.get(t.project_id) as { name: string } | undefined)?.name ?? null),
          type: (typeName.get(t.type_id) as { name: string } | undefined)?.name ?? '',
          workdir: t.workdir,
          description: t.description,
          sum: { what: t.sum_what, where: t.sum_where, next: t.sum_next },
          // do mais antigo ao mais novo
          checkpoints: [...t.checkpoints].reverse().map((c) => ({ at: c.at, text: c.text })),
          sessions: [...t.sessions].reverse().map((s) => ({
            at: s.started_at,
            external_id: s.external_id,
            tool: s.tool,
            label: s.label
          }))
        }
      })
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return { live: one(listTasks(d, 'attention')), done: one(listTasks(d, {})) }
}

const stamp = (d: Date): string =>
  d
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-')

/**
 * Exporta todas as tasks para `<dest>/<id>-export-YYYYMMDD-HHMMSS/{current,done}/<KEY>/README.md`.
 * A pasta nasce como `.<nome>.partial` e só ganha o nome final no fim; erro no meio apaga o parcial.
 * Nunca escreve em pasta que já existe nem fora da pasta nova.
 */
export async function exportMarkdown(
  d: DomainDeps,
  dest: string,
  fs: ExportFs = nodeExportFs
): Promise<{ dir: string; tasks: number }> {
  if (!isAbsolutePath(dest) || !(await isDir(dest)))
    throw importError('VALIDATION', 'export_dest_invalid')
  const { live, done } = collect(d)

  const base = `${BRAND.id}-export-${stamp(d.now())}`
  let name = base
  for (let n = 2; await exists(join(dest, name)); n++) name = `${base}-${n}`
  const final = join(dest, name)
  const partial = join(dest, `.${name}.partial`)

  try {
    await fs.mkdir(partial)
    for (const [sub, tasks] of [
      ['current', live],
      ['done', done]
    ] as const) {
      if (tasks.length === 0) continue
      await fs.mkdir(join(partial, sub))
      const used = new Set<string>()
      for (const t of tasks) {
        const base = safeDirName(t.key)
        let dir = base
        // colisão (também em disco que ignora maiúsculas): -2, -3…
        for (let n = 2; used.has(dir.toLowerCase()); n++) dir = `${base}-${n}`
        used.add(dir.toLowerCase())
        await fs.mkdir(join(partial, sub, dir))
        await fs.writeFile(join(partial, sub, dir, 'README.md'), renderReadme(t))
      }
    }
    await fs.rename(partial, final)
  } catch (e) {
    await fs.rm(partial).catch(() => undefined)
    throw e
  }
  return { dir: final, tasks: live.length + done.length }
}
