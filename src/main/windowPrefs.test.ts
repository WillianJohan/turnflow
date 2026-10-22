import { expect, it } from 'vitest'
import { windowPrefs } from './windowPrefs'

it('renderer em sandbox, isolado e sem Node', () => {
  expect(windowPrefs('/p.js')).toEqual({
    preload: '/p.js',
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false
  })
})
