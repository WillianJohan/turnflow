import { expect, it } from 'vitest'
import { isTextField } from './focus'

const el = (tagName: string, className = ''): { tagName: string; className: string } => ({
  tagName,
  className
})

it('input e textarea comuns são campo de texto', () => {
  expect(isTextField(el('INPUT'))).toBe(true)
  expect(isTextField(el('TEXTAREA'))).toBe(true)
})
it('textarea escondido do xterm NÃO é (senão o paste perde o bracketed paste)', () =>
  expect(isTextField(el('TEXTAREA', 'xterm-helper-textarea'))).toBe(false))
it('nada focado', () => expect(isTextField(null)).toBe(false))
