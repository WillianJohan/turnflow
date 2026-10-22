import { createReadStream } from 'fs'
import { access, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { createInterface } from 'readline'
import { CLAUDE_PROJECTS } from './config'

export async function findSessionFile(
  uuid: string,
  projectsDir = CLAUDE_PROJECTS
): Promise<{ path: string; cwd: string } | null> {
  const projects = await readdir(projectsDir).catch(() => [] as string[])
  for (const proj of projects) {
    const path = join(projectsDir, proj, `${uuid}.jsonl`)
    if (
      !(await access(path).then(
        () => true,
        () => false
      ))
    )
      continue
    const rl = createInterface({ input: createReadStream(path) })
    let cwd = ''
    for await (const line of rl) {
      const m = line.match(/"cwd":"((?:[^"\\]|\\.)*)"/)
      if (m) {
        cwd = JSON.parse(`"${m[1]}"`)
        break
      }
    }
    rl.close()
    return { path, cwd }
  }
  return null
}

export async function runningElsewhere(
  uuid: string,
  ownPids: Set<number>,
  procDir = '/proc'
): Promise<number | null> {
  for (const pid of await readdir(procDir).catch(() => [] as string[])) {
    if (!/^\d+$/.test(pid) || ownPids.has(Number(pid))) continue
    const args = (await readFile(join(procDir, pid, 'cmdline'), 'utf8').catch(() => '')).split('\0')
    if (args.includes(uuid) && args.some((a) => /(^|\/)claude$/.test(a))) return Number(pid)
  }
  return null
}

type Block = { type: string; text?: string }

export async function transcriptTail(path: string, maxChars = 8000): Promise<string> {
  const lines: string[] = []
  const rl = createInterface({ input: createReadStream(path) })
  for await (const raw of rl) {
    let o: { type?: string; isSidechain?: boolean; message?: { content?: string | Block[] } }
    try {
      o = JSON.parse(raw)
    } catch {
      continue
    }
    if ((o.type !== 'user' && o.type !== 'assistant') || o.isSidechain) continue
    const c = o.message?.content
    const text =
      typeof c === 'string'
        ? c
        : (c ?? [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
    if (text.trim()) lines.push(`${o.type === 'user' ? 'Johan' : 'Claude'}: ${text.trim()}`)
  }
  const out: string[] = []
  let size = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    size += lines[i].length + (out.length ? 1 : 0)
    if (size > maxChars) break
    out.unshift(lines[i])
  }
  return out.join('\n')
}
