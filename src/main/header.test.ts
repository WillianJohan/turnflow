import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, utimes } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { HEADER_ARGS, buildPrompt, getHeader, isStale, parseHeader } from './header'
import type { Task } from '../shared/types'

describe('parseHeader', () => {
  it('aceita negrito e ordem livre', () => {
    expect(parseHeader('**Próximo:** c\nlixo\n**O que é:** a\nParei em: b')).toEqual({
      what: 'a',
      where: 'b',
      next: 'c'
    })
  })
  it('faltando linha → null', () => expect(parseHeader('O que é: a\nParei em: b')).toBeNull())
})

describe('isStale', () => {
  const MIN = 60_000
  const c = {
    readmeMtime: 10,
    jsonlMtime: 20,
    generatedAt: 0,
    header: { what: '', where: '', next: '' }
  }
  it('sem cache', () => expect(isStale(null, 1, 1, 0)).toBe(true))
  it('mesmos mtimes', () => expect(isStale(c, 10, 20, 99 * MIN)).toBe(false))
  it('README mais novo', () => expect(isStale(c, 11, 20, 1)).toBe(true))
  it('conversa andou há pouco: não regera a cada troca de aba', () =>
    expect(isStale(c, 10, 21, 5 * MIN)).toBe(false))
  it('conversa andou e o resumo tem mais de 10 min', () =>
    expect(isStale(c, 10, 21, 11 * MIN)).toBe(true))
})

it('buildPrompt leva README e tail', () => {
  const p = buildPrompt('README-X', 'TAIL-Y')
  expect(p).toContain('README-X')
  expect(p).toContain('TAIL-Y')
  expect(p).toContain('O que é:')
})

describe('getHeader', () => {
  const setup = async (): Promise<{ task: Task; dir: string }> => {
    const dir = await mkdtemp(join(tmpdir(), 'dk-'))
    const readmePath = join(dir, 'README.md')
    await writeFile(readmePath, '# WF-1 — t')
    const task: Task = {
      id: 'WF-1',
      title: 't',
      status: '',
      bucket: { idx: 10, name: 'Outros' },
      parent: null,
      dir: 'current',
      readmePath,
      sessions: []
    }
    return { task, dir }
  }

  it('gera, grava cache e não regera sem mudança', async () => {
    const { task, dir } = await setup()
    let calls = 0
    const run = async (): Promise<string> => (calls++, 'O que é: a\nParei em: b\nPróximo: c')
    const h1 = await getHeader(task, false, { cacheDir: dir, run })
    const h2 = await getHeader(task, false, { cacheDir: dir, run })
    expect(h1?.header).toEqual({ what: 'a', where: 'b', next: 'c' })
    expect(h2?.header).toEqual(h1?.header)
    expect(calls).toBe(1)
    await getHeader(task, true, { cacheDir: dir, run })
    expect(calls).toBe(2)
  })

  it('falha mantém o anterior e grava error', async () => {
    const { task, dir } = await setup()
    await getHeader(task, false, {
      cacheDir: dir,
      run: async () => 'O que é: a\nParei em: b\nPróximo: c'
    })
    await utimes(task.readmePath, new Date(), new Date(Date.now() + 5000))
    const h = await getHeader(task, false, {
      cacheDir: dir,
      run: async () => {
        throw new Error('timeout de 60s')
      }
    })
    expect(h?.header.what).toBe('a')
    expect(h?.error).toContain('timeout')
  })

  it('erro no ↻ (force) não gruda: a próxima abertura tenta de novo', async () => {
    const { task, dir } = await setup()
    await getHeader(task, false, {
      cacheDir: dir,
      run: async () => 'O que é: a\nParei em: b\nPróximo: c'
    })
    await getHeader(task, true, {
      cacheDir: dir,
      run: async () => {
        throw new Error('falhou')
      }
    })
    let calls = 0
    const h = await getHeader(task, false, {
      cacheDir: dir,
      run: async () => (calls++, 'O que é: x\nParei em: y\nPróximo: z')
    })
    expect(calls).toBe(1)
    expect(h?.error).toBeUndefined()
  })

  it('saída sem as 3 linhas também é erro', async () => {
    const { task, dir } = await setup()
    const h = await getHeader(task, false, { cacheDir: dir, run: async () => 'blá' })
    expect(h?.error).toBeTruthy()
  })
})

it('geração não grava sessão nem roda hooks (não polui o /resume)', () => {
  expect(HEADER_ARGS).toContain('--no-session-persistence')
  expect(HEADER_ARGS.join(' ')).toContain('disableAllHooks')
})
