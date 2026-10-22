import { expect, it } from 'vitest'
import { notifyText, shouldNotify } from './notify'

const base = { state: 'waiting' as const, enabled: true, watching: false, lastAt: 0, now: 100_000 }

it('avisa quando o claude passa a esperar e você não está vendo a aba', () =>
  expect(shouldNotify(base)).toBe(true))
it('não avisa se você está olhando a aba', () =>
  expect(shouldNotify({ ...base, watching: true })).toBe(false))
it('não avisa trabalhando/parado', () => {
  expect(shouldNotify({ ...base, state: 'working' })).toBe(false)
  expect(shouldNotify({ ...base, state: 'idle' })).toBe(false)
})
it('no máximo um a cada 15s por task', () => {
  expect(shouldNotify({ ...base, lastAt: 90_000 })).toBe(false)
  expect(shouldNotify({ ...base, lastAt: 80_000 })).toBe(true)
})
it('desligado nas configurações não avisa', () =>
  expect(shouldNotify({ ...base, enabled: false })).toBe(false))

it('texto: permissão usa a mensagem do claude', () =>
  expect(
    notifyText('WF-5024', {
      event: 'Notification',
      message: 'Claude needs your permission to use Bash'
    })
  ).toEqual({
    title: 'WF-5024 · Pediu permissão',
    body: 'Claude needs your permission to use Bash'
  }))
it('texto: fim de turno', () =>
  expect(notifyText('WF-5024', { event: 'Stop' })).toEqual({
    title: 'WF-5024 · Terminou',
    body: 'Esperando você'
  }))
it('início de sessão não é pendência', () =>
  expect(notifyText('WF-1', { event: 'SessionStart' })).toBeNull())
