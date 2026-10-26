import { describe, expect, it, vi } from 'vitest'
import { binMatch, findProcessByArg, parsePs, parseWinProcs } from './procs'

const U = '00000000-0000-4000-8000-000000000001'

describe('parsePs', () => {
  it('parsePs', () => {
    expect(parsePs('  12 claude --resume U\n\n  34 vim file\n  56 /bin/zsh\n')).toEqual([
      { pid: 12, args: ['claude', '--resume', 'U'] },
      { pid: 34, args: ['vim', 'file'] },
      { pid: 56, args: ['/bin/zsh'] }
    ])
  })
})

describe('parseWinProcs', () => {
  it('parseWinProcs com aspas', () => {
    expect(parseWinProcs('4242\t"C:\\Program Files\\x\\claude.exe" --resume U\n')).toEqual([
      { pid: 4242, args: ['C:\\Program Files\\x\\claude.exe', '--resume', 'U'] }
    ])
  })
})

describe('findProcessByArg', () => {
  it('darwin chama ps e acha o pid', async () => {
    const exec = vi.fn(async () => `  9 claude --resume ${U}\n`)
    await expect(
      findProcessByArg(U, { ownPids: new Set(), platform: 'darwin', exec })
    ).resolves.toBe(9)
    expect(exec).toHaveBeenCalledWith('ps', ['-axww', '-o', 'pid=,args='])
  })

  it('win32 chama powershell e acha o pid', async () => {
    const exec = vi.fn(async () => `9\t"C:\\claude.exe" --resume ${U}\n`)
    await expect(
      findProcessByArg(U, { ownPids: new Set(), platform: 'win32', exec })
    ).resolves.toBe(9)
    expect(exec).toHaveBeenCalledWith('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'
    ])
  })

  it('pid próprio é pulado', async () => {
    const exec = vi.fn(async () => `9 claude --resume ${U}\n`)
    await expect(
      findProcessByArg(U, { ownPids: new Set([9]), platform: 'darwin', exec })
    ).resolves.toBeNull()
  })

  it('exec que falha devolve null', async () => {
    const exec = vi.fn(async () => {
      throw new Error('ps ausente')
    })
    await expect(
      findProcessByArg(U, { ownPids: new Set(), platform: 'darwin', exec })
    ).resolves.toBeNull()
  })

  it('binMatch codex não casa claude', async () => {
    const exec = vi.fn(async () => `9 /usr/bin/claude --resume ${U}\n`)
    await expect(
      findProcessByArg(U, {
        ownPids: new Set(),
        platform: 'darwin',
        exec,
        match: binMatch('codex')
      })
    ).resolves.toBeNull()
    await expect(
      findProcessByArg(U, {
        ownPids: new Set(),
        platform: 'darwin',
        exec,
        match: binMatch('claude-code')
      })
    ).resolves.toBe(9)
  })
})
