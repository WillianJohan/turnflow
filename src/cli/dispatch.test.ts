import { PassThrough } from 'stream'
import { describe, expect, it } from 'vitest'
import { parseCli, runCli } from './dispatch'
import { BRAND } from '../shared/brand'

describe('parseCli', () => {
  it('dev (electron <appDir> mcp) → cli mcp', () => {
    expect(parseCli(['electron', '.', 'mcp'])).toEqual({ mode: 'cli', cmd: 'mcp', args: [] })
    expect(parseCli(['/r/node_modules/electron/dist/electron', '/r', 'mcp'])).toEqual({
      mode: 'cli',
      cmd: 'mcp',
      args: []
    })
  })
  it('empacotado com args depois do subcomando', () => {
    expect(parseCli([`/opt/${BRAND.name}/turnflow`, 'mcp', '--token-file', 'x'])).toEqual({
      mode: 'cli',
      cmd: 'mcp',
      args: ['--token-file', 'x']
    })
  })
  it('run também é subcomando', () => {
    expect(parseCli(['/opt/t', 'run', 'a'])).toEqual({ mode: 'cli', cmd: 'run', args: ['a'] })
  })
  it('sem subcomando → app', () => {
    expect(parseCli(['/opt/t'])).toEqual({ mode: 'app' })
    expect(parseCli(['electron', '.'])).toEqual({ mode: 'app' })
  })
  it('ignora flags do Electron/Chromium antes do subcomando', () => {
    expect(parseCli(['/opt/t', '--inspect=9229'])).toEqual({ mode: 'app' })
    expect(parseCli(['/opt/t', '--no-sandbox', '--ozone-platform=wayland', 'mcp'])).toEqual({
      mode: 'cli',
      cmd: 'mcp',
      args: []
    })
    expect(parseCli(['electron', '--inspect=9229', '.', 'mcp'])).toEqual({
      mode: 'cli',
      cmd: 'mcp',
      args: []
    })
  })
  it('positional que não é path nem subcomando → app (ex.: arquivo aberto)', () => {
    expect(parseCli(['/opt/t', 'notas', 'mcp'])).toEqual({ mode: 'app' })
  })
})

const text = (s: PassThrough): string => (s.read() ?? '').toString()

describe('runCli', () => {
  it('run ainda não existe: stderr e 1', async () => {
    const stderr = new PassThrough()
    const code = await runCli(
      { mode: 'cli', cmd: 'run', args: [] },
      {
        socket: '/nao/existe',
        env: {},
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr
      }
    )
    expect(code).toBe(1)
    expect(text(stderr)).toContain('ainda não disponível')
  })
  it('--token-file ilegível: stderr e 1, sem conectar', async () => {
    const stderr = new PassThrough()
    const code = await runCli(
      { mode: 'cli', cmd: 'mcp', args: ['--token-file', '/nao/existe/token'] },
      {
        socket: '/nao/existe',
        env: {},
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr
      }
    )
    expect(code).toBe(1)
    expect(text(stderr)).toContain('/nao/existe/token')
  })
})
