import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hookSettings, writeHookSettings } from './hooks'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('writeHookSettings', () => {
  it('writeHookSettings grava 0600 em dir 0700', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hooks-'))
    dirs.push(dir)
    if (process.platform !== 'win32') await chmod(dir, 0o755)
    const p = await writeHookSettings(dir)
    expect(p).toBe(join(dir, 'hooks.json'))
    expect(JSON.parse(await readFile(p, 'utf8'))).toEqual(hookSettings())
    if (process.platform === 'win32') return
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await stat(p)).mode & 0o777).toBe(0o600)
  })
})
