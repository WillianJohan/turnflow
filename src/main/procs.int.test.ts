import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findProcessByArg } from './procs'

const U = '00000000-0000-4000-8000-000000000001'

describe('findProcessByArg linux', () => {
  it('linux lê cmdline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'procs-'))
    await mkdir(join(dir, '100'))
    await mkdir(join(dir, '101'))
    await writeFile(join(dir, '100', 'cmdline'), `claude\0--resume\0${U}\0`)
    await writeFile(join(dir, '101', 'cmdline'), `vim\0${U}\0`)
    await expect(
      findProcessByArg(U, { ownPids: new Set(), platform: 'linux', procDir: dir })
    ).resolves.toBe(100)
    await expect(
      findProcessByArg(U, { ownPids: new Set([100]), platform: 'linux', procDir: dir })
    ).resolves.toBeNull()
  })
})
