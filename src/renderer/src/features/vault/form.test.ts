import { describe, expect, it } from 'vitest'
import type { Boot } from '../../../../shared/ipc/vault'
import { COPY } from './copy'
import { canContinue, passwordProblem, screenFor, withoutChannel } from './form'

const w24 = Array.from({ length: 24 }, (_, i) => `w${i}`)
const boot = (o: Partial<Boot>): Boot => ({
  state: 'first_run',
  backend: 'basic_text',
  lock: null,
  failure: null,
  version: '1.0.0',
  ...o
})

describe('passwordProblem', () => {
  it('menos de 12 caracteres', () => {
    expect(passwordProblem('a'.repeat(11), 'a'.repeat(11))).toBe(COPY.passwordShort)
  })
  it('12 iguais passa', () => {
    expect(passwordProblem('a'.repeat(12), 'a'.repeat(12))).toBeNull()
  })
  it('diferentes', () => {
    expect(passwordProblem('a'.repeat(12), 'b'.repeat(12))).toBe(COPY.passwordMismatch)
  })
})

describe('canContinue', () => {
  it('sem marcar o checkbox', () => expect(canContinue(false, w24)).toBe(false))
  it('sem palavras', () => expect(canContinue(true, null)).toBe(false))
  it('marcado e com as 24', () => expect(canContinue(true, w24)).toBe(true))
})

describe('screenFor', () => {
  it.each([
    ['first_run basic_text sem palavras', boot({}), 'default', null, 'new_password'],
    ['first_run com palavras', boot({}), 'default', w24, 'words'],
    ['first_run real vai direto às palavras', boot({ backend: 'real' }), 'default', null, 'words'],
    [
      'locked por chaveiro indisponível',
      boot({ state: 'locked', backend: 'real', lock: 'keyring_unavailable' }),
      'default',
      null,
      'recover'
    ],
    [
      'locked por arquivo da chave corrompido',
      boot({ state: 'locked', lock: 'keyfile_corrupt' }),
      'default',
      null,
      'recover'
    ],
    [
      'locked em modo recover',
      boot({ state: 'locked', lock: 'password' }),
      'recover',
      null,
      'recover'
    ],
    ['locked por senha', boot({ state: 'locked', lock: 'password' }), 'default', null, 'unlock'],
    [
      'failed',
      boot({ state: 'failed', failure: { code: 'OPEN_FAILED', message: 'x' } }),
      'default',
      null,
      'failed'
    ],
    ['ready', boot({ state: 'ready' }), 'default', null, 'app']
  ] as const)('%s', (_name, b, mode, words, want) => {
    expect(screenFor(b, mode, words === null ? null : [...words])).toBe(want)
  })
})

describe('withoutChannel', () => {
  it('tira o prefixo do canal que o handle põe na validação', () => {
    expect(withoutChannel('firstRun.begin: A senha precisa de pelo menos 12 caracteres')).toBe(
      'A senha precisa de pelo menos 12 caracteres'
    )
    expect(withoutChannel('tasks:list: falhou')).toBe('falhou')
  })
  it('mensagem sem prefixo fica igual', () => {
    expect(withoutChannel('Senha incorreta. Esqueceu? Use a chave de recuperação.')).toBe(
      'Senha incorreta. Esqueceu? Use a chave de recuperação.'
    )
  })
})
