import { describe, expect, it } from 'vitest'
import { helloLine, resolveToken } from './mcp'

const read = (files: Record<string, string>) => (p: string) => {
  if (!(p in files)) throw new Error(`ENOENT ${p}`)
  return files[p]
}

describe('resolveToken', () => {
  it('TURNFLOW_SESSION_TOKEN vence --token-file e TURNFLOW_MCP_TOKEN', () => {
    const env = { TURNFLOW_SESSION_TOKEN: 's', TURNFLOW_MCP_TOKEN: 'm' }
    expect(resolveToken(env, ['--token-file', 'f'], read({ f: 'arq' }))).toBe('s')
  })
  it('--token-file vence TURNFLOW_MCP_TOKEN e vem sem o \\n final', () => {
    expect(
      resolveToken({ TURNFLOW_MCP_TOKEN: 'm' }, ['--token-file', 'f'], read({ f: 'arq\n' }))
    ).toBe('arq')
  })
  it('--token-file=<path> também vale', () => {
    expect(resolveToken({}, ['--token-file=f'], read({ f: 'arq' }))).toBe('arq')
  })
  it('só TURNFLOW_MCP_TOKEN', () => {
    expect(resolveToken({ TURNFLOW_MCP_TOKEN: 'm' }, [], read({}))).toBe('m')
  })
  it('nada → string vazia', () => {
    expect(resolveToken({}, [], read({}))).toBe('')
  })
  it('--token-file ilegível propaga o erro', () => {
    expect(() => resolveToken({}, ['--token-file', 'x'], read({}))).toThrow('x')
  })
})

it('helloLine é a 1ª linha NDJSON do contrato', () => {
  expect(helloLine('t')).toBe('{"turnflow":"hello","v":1,"kind":"mcp","token":"t"}\n')
})
