import { createHash } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DomainError } from '../../domain/errors'
import { tmpDir } from '../../testing/db'
import { MAX_README_BYTES, nodeBrainFs, scanBrain, type BrainFs } from './scan'
import { readme, writeBrain } from './testing/brainFixture'

const R = (key: string): string => readme({ key })

/** Embrulha o fs de verdade e registra cada leitura. */
function spyFs(): { fs: BrainFs; read: string[]; listed: string[] } {
  const read: string[] = []
  const listed: string[] = []
  const fs: BrainFs = {
    ...nodeBrainFs,
    readFile: (p) => (read.push(p), nodeBrainFs.readFile(p)),
    readdir: (p) => (listed.push(p), nodeBrainFs.readdir(p))
  }
  return { fs, read, listed }
}

/** Foto da árvore: tipo, modo, mtime, conteúdo/alvo de cada nó. */
function snapshot(root: string, rel = ''): string[] {
  const abs = join(root, rel)
  const st = lstatSync(abs)
  const head = `${rel || '.'} ${st.mode.toString(8)} ${st.mtimeMs}`
  if (st.isSymbolicLink()) return [`${head} -> ${readlinkSync(abs)}`]
  if (st.isDirectory()) {
    return [
      head,
      ...readdirSync(abs)
        .sort()
        .flatMap((n) => snapshot(root, join(rel, n)))
    ]
  }
  // modo 000 não lê: o hash fica de fora, o modo e o mtime já provam.
  let h = 'unreadable'
  try {
    h = createHash('sha256').update(readFileSync(abs)).digest('hex')
  } catch {
    /* sem permissão */
  }
  return [`${head} ${h}`]
}

describe('scanBrain', () => {
  it('acha current, backlog e done', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'tasks/current/ABC-1/README.md': R('ABC-1'),
      'tasks/backlog/ABC-2/README.md': R('ABC-2'),
      'tasks/done/ABC-3/README.md': R('ABC-3')
    })
    const scan = await scanBrain(root)
    expect(scan.root).toBe(root)
    expect(scan.tasks.map((t) => [t.key, t.dir])).toEqual([
      ['ABC-1', 'current'],
      ['ABC-2', 'backlog'],
      ['ABC-3', 'done']
    ])
    expect(scan.tasks[0]!.source_path).toBe('current/ABC-1/README.md')
    expect(scan.tasks[0]!.file_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(scan.tasks[0]!.text).toBe(R('ABC-1'))
    expect(scan.tasks[0]!.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(scan.ignored).toEqual([])
  })

  it('raiz pode ser tasks/', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'tasks/current/ABC-1/README.md': R('ABC-1'),
      'tasks/done/ABC-3/README.md': R('ABC-3')
    })
    const a = await scanBrain(root)
    const b = await scanBrain(join(root, 'tasks'))
    expect(b.tasks.map((t) => t.key)).toEqual(a.tasks.map((t) => t.key))
    expect(b.tasks.map((t) => t.source_path)).toEqual(a.tasks.map((t) => t.source_path))
    expect(b.tasks[0]!.source_path).toBe('current/ABC-1/README.md')
  })

  it('credentials nunca é aberto', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'credentials/service.md': 'segredo sintético',
      'tasks/current/ABC-1/README.md': R('ABC-1'),
      'tasks/current/ABC-1/credentials/x.md': 'segredo sintético'
    })
    const { fs, read } = spyFs()
    const scan = await scanBrain(root, fs)
    expect(scan.ignored).toEqual(
      expect.arrayContaining([
        { path: 'credentials/service.md', reason: 'credentials' },
        { path: 'tasks/current/ABC-1/credentials/x.md', reason: 'credentials' }
      ])
    )
    expect(scan.tasks[0]!.attachments).toEqual([])
    expect(read.filter((p) => /credentials/i.test(p))).toEqual([])
    expect(read).toEqual([join(root, 'tasks/current/ABC-1/README.md')])
  })

  it.skipIf(process.getuid?.() === 0)('credentials ilegível não derruba o scan', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'credentials/service.md': 'segredo sintético',
      'tasks/current/ABC-1/README.md': R('ABC-1'),
      'tasks/current/ABC-1/credentials/x.md': 'segredo sintético'
    })
    try {
      chmodSync(join(root, 'credentials/service.md'), 0o000)
      chmodSync(join(root, 'tasks/current/ABC-1/credentials/x.md'), 0o000)
      const scan = await scanBrain(root)
      expect(scan.tasks.map((t) => t.key)).toEqual(['ABC-1'])
      expect(scan.ignored.map((i) => i.reason)).toEqual(['credentials', 'credentials'])
      // pasta credentials sem permissão de listar: ainda assim vira ignored, sem erro
      chmodSync(join(root, 'credentials'), 0o000)
      const again = await scanBrain(root)
      expect(again.tasks).toHaveLength(1)
      expect(again.ignored).toContainEqual({ path: 'credentials', reason: 'credentials' })
    } finally {
      chmodSync(join(root, 'credentials'), 0o755)
      chmodSync(join(root, 'credentials/service.md'), 0o644)
      chmodSync(join(root, 'tasks/current/ABC-1/credentials/x.md'), 0o644)
    }
  })

  it('pasta de task chamada credentials é ignorada sem leitura', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'tasks/current/credentials/README.md': 'segredo sintético',
      'tasks/current/ABC-1/README.md': R('ABC-1')
    })
    const { fs, read } = spyFs()
    const scan = await scanBrain(root, fs)
    expect(scan.ignored).toContainEqual({
      path: 'tasks/current/credentials/README.md',
      reason: 'credentials'
    })
    expect(read.filter((p) => /credentials/i.test(p))).toEqual([])
  })

  it('anexos pendentes', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'tasks/current/ABC-1/README.md': R('ABC-1'),
      'tasks/current/ABC-1/notes.txt': 'abc',
      'tasks/current/ABC-1/img/a.png': 'pngpng'
    })
    const { fs, read } = spyFs()
    const scan = await scanBrain(root, fs)
    const att = scan.tasks[0]!.attachments
    expect(att).toEqual([
      {
        key: 'ABC-1',
        name: 'img/a.png',
        path: join(root, 'tasks/current/ABC-1/img/a.png'),
        size: 6
      },
      {
        key: 'ABC-1',
        name: 'notes.txt',
        path: join(root, 'tasks/current/ABC-1/notes.txt'),
        size: 3
      }
    ])
    expect(read).toEqual([join(root, 'tasks/current/ABC-1/README.md')]) // anexo não é lido
  })

  it('pasta que não é key vai para ignored', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'tasks/current/notes/README.md': 'x',
      'tasks/current/abc-9/README.md': 'x'
    })
    mkdirSync(join(root, 'tasks/current/ABC-4'), { recursive: true })
    const scan = await scanBrain(root)
    expect(scan.tasks).toEqual([])
    expect(scan.ignored).toEqual(
      expect.arrayContaining([
        { path: 'tasks/current/notes', reason: 'not_a_key' },
        { path: 'tasks/current/abc-9', reason: 'not_a_key' },
        { path: 'tasks/current/ABC-4', reason: 'no_readme' }
      ])
    )
  })

  it('symlink não é seguido (pasta, README e anexo)', async () => {
    const root = tmpDir()
    const out = tmpDir()
    writeBrain(out, {
      'outside/README.md': R('ABC-5'),
      'file.txt': 'fora',
      'readme.md': R('ABC-6'),
      'credentials/s.md': 'segredo sintético'
    })
    writeBrain(root, {
      'tasks/current/ABC-6/other.txt': 'x',
      'tasks/current/ABC-7/README.md': R('ABC-7')
    })
    symlinkSync(join(out, 'outside'), join(root, 'tasks/current/ABC-5'))
    symlinkSync(join(out, 'readme.md'), join(root, 'tasks/current/ABC-6/README.md'))
    symlinkSync(join(out, 'file.txt'), join(root, 'tasks/current/ABC-7/link.txt'))
    symlinkSync(join(out, 'credentials'), join(root, 'tasks/current/ABC-7/dirlink'))
    const { fs, read, listed } = spyFs()
    const scan = await scanBrain(root, fs)
    expect(scan.tasks.map((t) => t.key)).toEqual(['ABC-7'])
    expect(scan.tasks[0]!.attachments).toEqual([])
    expect(scan.ignored).toEqual(
      expect.arrayContaining([
        { path: 'tasks/current/ABC-5', reason: 'symlink' },
        { path: 'tasks/current/ABC-6/README.md', reason: 'symlink' },
        { path: 'tasks/current/ABC-7/link.txt', reason: 'symlink' },
        { path: 'tasks/current/ABC-7/dirlink', reason: 'symlink' }
      ])
    )
    expect(read.filter((p) => !p.startsWith(root))).toEqual([])
    expect(listed.filter((p) => !p.startsWith(root))).toEqual([])
  })

  it('README grande', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'tasks/current/ABC-1/README.md': 'a'.repeat(MAX_README_BYTES + 1),
      'tasks/current/ABC-2/README.md': 'a'.repeat(MAX_README_BYTES)
    })
    const { fs, read } = spyFs()
    const scan = await scanBrain(root, fs)
    expect(scan.tasks.map((t) => t.key)).toEqual(['ABC-2'])
    expect(scan.ignored).toContainEqual({
      path: 'tasks/current/ABC-1/README.md',
      reason: 'too_large'
    })
    expect(read).toEqual([join(root, 'tasks/current/ABC-2/README.md')])
  })

  it('duplicata: current > backlog > done', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'tasks/done/ABC-1/README.md': R('ABC-1'),
      'tasks/backlog/ABC-1/README.md': R('ABC-1'),
      'tasks/current/ABC-1/README.md': R('ABC-1'),
      'tasks/done/ABC-2/README.md': R('ABC-2'),
      'tasks/backlog/ABC-2/README.md': R('ABC-2')
    })
    const scan = await scanBrain(root)
    expect(scan.tasks.map((t) => [t.key, t.dir])).toEqual([
      ['ABC-1', 'current'],
      ['ABC-2', 'backlog']
    ])
    expect(scan.ignored).toEqual(
      expect.arrayContaining([
        { path: 'tasks/backlog/ABC-1', reason: 'duplicate' },
        { path: 'tasks/done/ABC-1', reason: 'duplicate' },
        { path: 'tasks/done/ABC-2', reason: 'duplicate' }
      ])
    )
    expect(scan.ignored).toHaveLength(3)
  })

  it('README ilegível vira unreadable', async () => {
    const root = tmpDir()
    writeBrain(root, { 'tasks/current/ABC-1/README.md': R('ABC-1') })
    const fs: BrainFs = {
      ...nodeBrainFs,
      readFile: () => Promise.reject(new Error('EACCES'))
    }
    const scan = await scanBrain(root, fs)
    expect(scan.tasks).toEqual([])
    expect(scan.ignored).toEqual([{ path: 'tasks/current/ABC-1/README.md', reason: 'unreadable' }])
  })

  it('raiz inválida', async () => {
    const reasons: unknown[] = []
    for (const r of [tmpDir(), 'relativo/tasks', join(tmpDir(), 'nao-existe')]) {
      const err = await scanBrain(r).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(DomainError)
      expect((err as DomainError).code).toBe('VALIDATION')
      reasons.push((err as DomainError).details?.reason)
    }
    expect(reasons).toEqual(['import_root_invalid', 'import_root_invalid', 'import_root_invalid'])
  })

  it('tasks demais', async () => {
    const root = tmpDir()
    writeBrain(root, { 'tasks/current/ABC-1/README.md': R('ABC-1') })
    const err = await scanBrain(root, nodeBrainFs, { maxTasks: 0 }).catch((e: unknown) => e)
    expect((err as DomainError).details?.reason).toBe('too_many_tasks')
  })

  it('só leitura: a árvore fica idêntica byte a byte', async () => {
    const root = tmpDir()
    const out = tmpDir()
    writeBrain(root, {
      'credentials/service.md': 'segredo sintético',
      'tasks/current/ABC-1/README.md': R('ABC-1'),
      'tasks/current/ABC-1/notes.txt': 'abc',
      'tasks/current/ABC-1/credentials/x.md': 'segredo sintético',
      'tasks/backlog/ABC-2/README.md': R('ABC-2'),
      'tasks/done/ABC-2/README.md': R('ABC-2')
    })
    writeFileSync(join(out, 'f.txt'), 'fora')
    symlinkSync(out, join(root, 'tasks/current/ABC-9'))
    symlinkSync(join(out, 'f.txt'), join(root, 'tasks/current/ABC-1/l.txt'))
    const locked = join(root, 'credentials/service.md')
    if (process.getuid?.() !== 0) chmodSync(locked, 0o000)
    try {
      const before = snapshot(root)
      await scanBrain(root)
      await scanBrain(join(root, 'tasks'))
      expect(snapshot(root)).toEqual(before)
      expect(snapshot(out).length).toBe(2)
    } finally {
      chmodSync(locked, 0o644)
    }
  })

  it('credentials* e .credentials*, em qualquer caixa, nunca viram anexo nem são lidos', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'tasks/current/ABC-1/README.md': R('ABC-1'),
      'tasks/current/ABC-1/credentials.json': 's',
      'tasks/current/ABC-1/Credentials/a.txt': 's',
      'tasks/current/ABC-1/CREDENTIALS-prod.env': 's',
      'tasks/current/ABC-1/.credentials': 's',
      'tasks/current/ABC-1/ok.txt': 'ok',
      'tasks/credentials/top.md': 's',
      'Credentials.md': 's'
    })
    const { fs, read } = spyFs()
    const scan = await scanBrain(root, fs)
    expect(scan.tasks[0]!.attachments.map((a) => a.name)).toEqual(['ok.txt'])
    expect(scan.ignored.map((i) => i.path).sort()).toEqual([
      'Credentials.md',
      'tasks/credentials/top.md',
      'tasks/current/ABC-1/.credentials',
      'tasks/current/ABC-1/CREDENTIALS-prod.env',
      'tasks/current/ABC-1/Credentials/a.txt',
      'tasks/current/ABC-1/credentials.json'
    ])
    expect(scan.ignored.every((i) => i.reason === 'credentials')).toBe(true)
    expect(read.filter((p) => /credentials/i.test(p))).toEqual([])
  })

  it('pastas com ponto e node_modules não são descidas: uma entrada em ignored', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'tasks/current/ABC-1/README.md': R('ABC-1'),
      'tasks/current/ABC-1/.git/objects/x': 'x',
      'tasks/current/ABC-1/src/node_modules/p/i.js': 'x',
      'tasks/current/ABC-1/src/a.txt': 'x'
    })
    const { fs, listed } = spyFs()
    const scan = await scanBrain(root, fs)
    expect(scan.tasks[0]!.attachments.map((a) => a.name)).toEqual(['src/a.txt'])
    expect(scan.ignored).toEqual([
      { path: 'tasks/current/ABC-1/.git', reason: 'skipped_dir' },
      { path: 'tasks/current/ABC-1/src/node_modules', reason: 'skipped_dir' }
    ])
    expect(listed.filter((p) => /\.git|node_modules/.test(p))).toEqual([])
  })

  it('teto de anexos por task e no total: excedente vira uma entrada com count', async () => {
    const root = tmpDir()
    const files: Record<string, string> = {}
    for (const k of ['ABC-1', 'ABC-2']) {
      files[`tasks/current/${k}/README.md`] = R(k)
      for (let i = 0; i < 5; i++) files[`tasks/current/${k}/f${i}.txt`] = 'x'
    }
    writeBrain(root, files)
    const per = await scanBrain(root, nodeBrainFs, { maxAttachmentsPerTask: 2 })
    expect(per.tasks.map((t) => t.attachments.length)).toEqual([2, 2])
    expect(per.ignored).toEqual([
      { path: 'tasks/current/ABC-1', reason: 'truncated', count: 3 },
      { path: 'tasks/current/ABC-2', reason: 'truncated', count: 3 }
    ])
    const total = await scanBrain(root, nodeBrainFs, { maxAttachmentsTotal: 6 })
    expect(total.tasks.map((t) => t.attachments.length)).toEqual([5, 1])
    expect(total.ignored).toEqual([{ path: 'tasks/current/ABC-2', reason: 'truncated', count: 4 }])
  })

  it('teto de ignored: excedente vira uma entrada truncated', async () => {
    const root = tmpDir()
    const files: Record<string, string> = { 'tasks/current/ABC-1/README.md': R('ABC-1') }
    for (let i = 0; i < 5; i++) files[`tasks/current/ABC-1/credentials/f${i}`] = 's'
    writeBrain(root, files)
    const scan = await scanBrain(root, nodeBrainFs, { maxIgnored: 2 })
    expect(scan.ignored).toHaveLength(3)
    expect(scan.ignored[2]).toEqual({ path: '.', reason: 'truncated', count: 3 })
  })

  it('teto agregado de READMEs lidos: VALIDATION too_large', async () => {
    const root = tmpDir()
    writeBrain(root, {
      'tasks/current/ABC-1/README.md': 'a'.repeat(100),
      'tasks/current/ABC-2/README.md': 'a'.repeat(100)
    })
    await expect(scanBrain(root, nodeBrainFs, { maxTotalReadBytes: 199 })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'too_large' }
    })
    await expect(scanBrain(root, nodeBrainFs, { maxTotalReadBytes: 200 })).resolves.toBeTruthy()
  })

  it('arquivo solto em current/ vai para ignored', async () => {
    const root = tmpDir()
    writeBrain(root, { 'tasks/current/ABC-1/README.md': R('ABC-1'), 'tasks/current/x.md': 'x' })
    const scan = await scanBrain(root)
    expect(scan.ignored).toEqual([{ path: 'tasks/current/x.md', reason: 'loose_file' }])
  })

  it('raiz que é symlink é aceita; tasks/ symlink vai para ignored', async () => {
    const real = tmpDir()
    writeBrain(real, { 'tasks/current/ABC-1/README.md': R('ABC-1') })
    const holder = tmpDir()
    const link = join(holder, 'brain-link')
    symlinkSync(real, link)
    const scan = await scanBrain(link)
    expect(scan.root).toBe(link)
    expect(scan.tasks.map((t) => t.key)).toEqual(['ABC-1'])

    const out = tmpDir()
    const root = tmpDir()
    writeBrain(out, { 'current/ABC-1/README.md': R('ABC-1') })
    symlinkSync(out, join(root, 'tasks'))
    const { fs, read } = spyFs()
    const s2 = await scanBrain(root, fs)
    expect(s2.tasks).toEqual([])
    expect(s2.ignored).toEqual([{ path: 'tasks', reason: 'symlink' }])
    expect(read).toEqual([])
  })

  it('README: stat velho não engana, a leitura é limitada e não segue symlink', async () => {
    const root = tmpDir()
    writeBrain(root, { 'tasks/current/ABC-1/README.md': 'a'.repeat(MAX_README_BYTES + 50) })
    let asked: number | undefined
    const fs: BrainFs = {
      ...nodeBrainFs,
      stat: () => Promise.resolve({ size: 10, mtimeMs: 0 }),
      readFile: (p, max) => ((asked = max), nodeBrainFs.readFile(p, max))
    }
    const scan = await scanBrain(root, fs)
    expect(scan.tasks).toEqual([])
    expect(scan.ignored).toEqual([{ path: 'tasks/current/ABC-1/README.md', reason: 'too_large' }])
    expect(asked).toBe(MAX_README_BYTES + 1)

    const dir = tmpDir()
    writeBrain(dir, { 'real.md': 'x' })
    symlinkSync(join(dir, 'real.md'), join(dir, 'link.md'))
    await expect(nodeBrainFs.readFile(join(dir, 'link.md'))).rejects.toThrow()
    expect((await nodeBrainFs.readFile(join(dir, 'real.md'), 1)).toString()).toBe('x')
  })

  it('readFile corta no maxBytes mesmo com arquivo maior', async () => {
    const dir = tmpDir()
    writeBrain(dir, { 'ten.md': '0123456789' })
    expect((await nodeBrainFs.readFile(join(dir, 'ten.md'), 3)).toString()).toBe('012')
  })
})
