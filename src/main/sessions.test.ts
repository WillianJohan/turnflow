import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { findSessionFile, runningElsewhere, transcriptTail } from './sessions'

const U = '6cf3f5b1-5d12-4759-bb5b-09a9aaea132f'
const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'dk-'))
const jl = (...o: object[]): string => o.map((x) => JSON.stringify(x)).join('\n') + '\n'

describe('findSessionFile', () => {
  it('acha o jsonl em qualquer projeto e devolve o cwd', async () => {
    const root = await tmp()
    await mkdir(join(root, 'proj-a'))
    await mkdir(join(root, 'proj-b'))
    await writeFile(
      join(root, 'proj-b', `${U}.jsonl`),
      jl({ type: 'mode' }, { type: 'user', cwd: '/w/x' })
    )
    expect(await findSessionFile(U, root)).toEqual({
      path: join(root, 'proj-b', `${U}.jsonl`),
      cwd: '/w/x'
    })
  })

  it('uuid ausente devolve null', async () => {
    expect(await findSessionFile(U, await tmp())).toBeNull()
  })
})

describe('runningElsewhere', () => {
  const proc = async (cmd: string): Promise<string> => {
    const root = await tmp()
    await mkdir(join(root, '123'))
    await mkdir(join(root, 'self'))
    await writeFile(join(root, '123', 'cmdline'), cmd)
    return root
  }

  it('acha claude com o uuid', async () => {
    expect(
      await runningElsewhere(U, new Set(), await proc(`node\0/usr/bin/claude\0--resume\0${U}\0`))
    ).toBe(123)
  })

  it('ignora pid do próprio app', async () => {
    expect(
      await runningElsewhere(U, new Set([123]), await proc(`claude\0--resume\0${U}\0`))
    ).toBeNull()
  })

  it('ignora cmdline sem claude', async () => {
    expect(await runningElsewhere(U, new Set(), await proc(`grep\0${U}\0`))).toBeNull()
  })
})

describe('transcriptTail', () => {
  it('só texto de user/assistant, corta do início', async () => {
    const p = join(await tmp(), 'x.jsonl')
    await writeFile(
      p,
      jl(
        { type: 'user', message: { content: 'primeira pergunta' } },
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Bash' },
              { type: 'text', text: 'resposta' }
            ]
          }
        },
        { type: 'user', message: { content: [{ type: 'tool_result', content: 'LIXO' }] } },
        { type: 'mode' },
        { type: 'user', message: { content: [{ type: 'text', text: 'segunda' }] } }
      )
    )
    const all = await transcriptTail(p)
    expect(all).toBe('Johan: primeira pergunta\nClaude: resposta\nJohan: segunda')
    expect(all).not.toContain('LIXO')
    expect(await transcriptTail(p, 14)).toBe('Johan: segunda')
  })
})
