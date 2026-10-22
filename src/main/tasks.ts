import { readdir, readFile } from 'fs/promises'
import { watch } from 'fs'
import { join } from 'path'
import { BRAIN_TASKS } from './config'

import type { Bucket, Dir, Task } from '../shared/types'
export type { Bucket, Dir, Task, SessionRef } from '../shared/types'

// Mesma ordem de casamento do _dk_bucket (.aliases.sh:125-143).
const RULES: [RegExp, number, string][] = [
  [/valida.*cs/, 6, 'Validação CS'],
  [/teste produ/, 7, 'Em teste produção'],
  [/conclu/, 8, 'Concluído'],
  [/gmud/, 2, 'GMUD'],
  [/merge request/, 1, 'Merge request'],
  [/bloquead/, 5, 'Bloqueado'],
  [/em andamento/, 3, 'Em andamento'],
  [/tarefas|refinamento/, 4, 'Tarefas'],
  [/em teste/, 3, 'Em andamento'],
  [/entregue/, 8, 'Concluído']
]

export function bucketOf(status: string, dir: Dir): Bucket {
  const s = status.toLowerCase()
  const r = RULES.find(([re]) => re.test(s))
  const b = r ? { idx: r[1], name: r[2] } : { idx: 10, name: 'Outros' }
  return dir === 'done' && b.idx <= 5 ? { idx: 9, name: 'Arquivada' } : b
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

export function parseReadme(text: string, id: string, dir: Dir, readmePath: string): Task {
  const lines = text.split('\n')
  const title = lines[0]?.match(/^# [A-Za-z0-9-]* — (.*)/)?.[1]?.trim() || id
  let status = ''
  let parent: string | null = null
  const sessions: Task['sessions'] = []
  let inSessions = false
  for (const l of lines) {
    const st = !status && l.match(/^(?:\*\*Status:\*\*|Status:)\s*(.*)/)
    if (st) status = st[1].trim()
    const pa = !parent && l.match(/^\*\*Pai:\*\*\s*([A-Z]+-\d+)/)
    if (pa) parent = pa[1]
    if (/^##\s/.test(l)) inSessions = /^##\s+Sess/.test(l)
    else if (inSessions && /^-\s/.test(l)) {
      const m = l.match(UUID)
      if (!m) continue
      const rest = l.replace(/^-\s+/, '')
      sessions.push({
        date: rest.split(/\s/)[0],
        uuid: m[0],
        desc: l
          .slice(m.index! + m[0].length)
          .replace(/^\s*(—|-)\s*/, '')
          .trim()
      })
    }
  }
  return { id, title, status, bucket: bucketOf(status, dir), parent, dir, readmePath, sessions }
}

export async function loadTasks(root = BRAIN_TASKS): Promise<Task[]> {
  const out: Task[] = []
  for (const dir of ['current', 'done'] as const) {
    const ids = await readdir(join(root, dir)).catch(() => [] as string[])
    for (const id of ids) {
      const p = join(root, dir, id, 'README.md')
      const text = await readFile(p, 'utf8').catch(() => null)
      if (text !== null) out.push(parseReadme(text, id, dir, p))
    }
  }
  return out
}

export function watchTasks(root: string, onChange: () => void): () => void {
  let t: NodeJS.Timeout | undefined
  let w: ReturnType<typeof watch> | null = null
  try {
    w = watch(root, { recursive: true }, () => {
      clearTimeout(t)
      t = setTimeout(onChange, 300)
    })
    w.on('error', () => undefined) // pasta movida/apagada durante o watch
  } catch {
    // brain inexistente: a lista vem vazia e o app avisa, sem derrubar a janela
  }
  return () => {
    clearTimeout(t)
    w?.close()
  }
}
