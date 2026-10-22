import { mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { tmpDir } from '../core/testing/db'
import { brainTasksDir, sessionCwd } from './brainDir'

describe('brainTasksDir', () => {
  it('sem env e sem pasta = null', () => {
    expect(brainTasksDir({}, null)).toBeNull()
  })

  it('TURNFLOW_BRAIN vence o config', () => {
    expect(brainTasksDir({ TURNFLOW_BRAIN: '/x' }, '/y')).toBe('/x')
    expect(brainTasksDir({ TURNFLOW_BRAIN: '/x' }, null)).toBe('/x')
  })

  it('TURNFLOW_BRAIN vazio não vence', () => {
    expect(brainTasksDir({ TURNFLOW_BRAIN: '' }, null)).toBeNull()
  })

  it('pasta com tasks/ aponta para tasks/', () => {
    const root = tmpDir()
    mkdirSync(join(root, 'tasks'))
    expect(brainTasksDir({}, root)).toBe(join(root, 'tasks'))
  })

  it('pasta sem tasks/ é a própria', () => {
    const root = tmpDir()
    expect(brainTasksDir({}, root)).toBe(root)
  })
})

describe('sessionCwd', () => {
  it('pasta padrão ou a home', () => {
    expect(sessionCwd('/abs/work')).toBe('/abs/work')
    expect(sessionCwd(null)).toBe(homedir())
  })
})
