import { expect, it } from 'vitest'
import { isExternalLink } from './links'

it('só http(s) vai pro navegador', () => {
  expect(isExternalLink('https://gitlab.digitalk.com.br/x')).toBe(true)
  expect(isExternalLink('http://localhost:3000')).toBe(true)
  expect(isExternalLink('ftp://x')).toBe(false)
  expect(isExternalLink('file:///etc/passwd')).toBe(false)
  expect(isExternalLink('smb://host/share')).toBe(false)
})
