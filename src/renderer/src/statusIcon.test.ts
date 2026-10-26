import { expect, it } from 'vitest'
import { formatIcon, parseIcon } from './statusIcon'

it('emoji fica como texto', () => expect(parseIcon('🚀')).toEqual({ kind: 'emoji', value: '🚀' }))
it('vazio é sem ícone', () => expect(parseIcon('')).toEqual({ kind: 'none' }))
it('ícone monocromático com cor', () =>
  expect(parseIcon('icon:rocket:#2e7cd1')).toEqual({
    kind: 'icon',
    name: 'rocket',
    color: '#2e7cd1'
  }))
it('ícone sem cor usa a cor do texto', () =>
  expect(parseIcon('icon:rocket')).toEqual({ kind: 'icon', name: 'rocket', color: null }))
it('cor inválida é ignorada (vira cor do texto)', () =>
  expect(parseIcon('icon:rocket:red;}')).toEqual({ kind: 'icon', name: 'rocket', color: null }))
it('ida e volta', () => {
  expect(formatIcon({ kind: 'icon', name: 'git-merge', color: '#cb7b37' })).toBe(
    'icon:git-merge:#cb7b37'
  )
  expect(formatIcon({ kind: 'icon', name: 'git-merge', color: null })).toBe('icon:git-merge')
  expect(formatIcon({ kind: 'emoji', value: '✅' })).toBe('✅')
  expect(formatIcon({ kind: 'none' })).toBe('')
})
