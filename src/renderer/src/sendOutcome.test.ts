import { describe, expect, it } from 'vitest'
import { sendOutcome } from './sendOutcome'

describe('sendOutcome (Composer)', () => {
  it('true → enviado', () => expect(sendOutcome({ ok: true, data: true })).toBe('sent'))
  it('false confirmado pelo main → sessão perdida', () =>
    expect(sendOutcome({ ok: true, data: false })).toBe('lost'))
  it('erro de IPC não é sessão perdida', () => {
    expect(sendOutcome({ ok: false, error: { code: 'VALIDATION', message: 'x' } })).toBe('error')
    expect(sendOutcome({ ok: false, error: { code: 'INTERNAL', message: 'x' } })).toBe('error')
  })
})
