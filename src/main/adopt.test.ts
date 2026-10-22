import { expect, it } from 'vitest'
import { adoptions } from './adopt'

const task = (id: string, uuids: string[]): { id: string; sessions: { uuid: string }[] } => ({
  id,
  sessions: uuids.map((uuid) => ({ uuid }))
})

it('aba avulsa cuja conversa apareceu no README vira a task', () => {
  expect(
    adoptions(new Map([['~claude-1', 'u1']]), [task('WF-5024', ['u0', 'u1'])], new Set())
  ).toEqual([{ from: '~claude-1', to: 'WF-5024' }])
})
it('terminal puro e aba de task não são adotados', () => {
  expect(
    adoptions(
      new Map([
        ['~shell-1', 'u1'],
        ['WF-1', 'u1']
      ]),
      [task('WF-5024', ['u1'])],
      new Set()
    )
  ).toEqual([])
})
it('task já com sessão viva no app não é tomada', () => {
  expect(
    adoptions(new Map([['~claude-1', 'u1']]), [task('WF-5024', ['u1'])], new Set(['WF-5024']))
  ).toEqual([])
})
it('conversa que nenhum README cita fica como está', () => {
  expect(adoptions(new Map([['~claude-1', 'u9']]), [task('WF-5024', ['u1'])], new Set())).toEqual(
    []
  )
})
