import { describe, expect, it } from 'vitest'
import { DAY_MS, attention, pickSession, type AttSession, type AttTask } from './attention'

const NOW = new Date('2026-10-22T12:00:00Z')
const iso = (offsetMs: number): string => new Date(NOW.getTime() + offsetMs).toISOString()
const H = 3_600_000

const task = (o: Partial<AttTask> = {}): AttTask => ({
  id: 'T1',
  done_at: null,
  turn_reason: null,
  turn_at: null,
  blocked_reason: null,
  blocked_at: null,
  project_id: null,
  touched_at: iso(-H),
  ...o
})
const sess = (state: AttSession['state'], o: Partial<AttSession> = {}): AttSession => ({
  state,
  state_at: '2026-10-22T10:00:00.000Z',
  ended_at: null,
  ...o
})
const stage = { waits_other: false }
const waitsOther = { waits_other: true }
const FOUR_D = iso(-4 * DAY_MS)

describe('attention: precedência', () => {
  it.each([
    [
      'done_at + sessão waiting',
      task({ done_at: iso(-H) }),
      stage,
      [sess('waiting')],
      'concluida',
      null
    ],
    [
      'sessão waiting + bloqueada',
      task({ blocked_reason: 'x', blocked_at: iso(-H) }),
      stage,
      [sess('waiting')],
      'sua_vez',
      'sessao_aguardando'
    ],
    [
      'voltou + bloqueada',
      task({ turn_reason: 'voltou', turn_at: iso(-H), blocked_reason: 'x', blocked_at: iso(-H) }),
      stage,
      [],
      'sua_vez',
      'voltou'
    ],
    [
      'bloqueada',
      task({ blocked_reason: 'x', blocked_at: iso(-H) }),
      stage,
      [],
      'encaminhado',
      'bloqueada'
    ],
    ['etapa waits_other', task(), waitsOther, [], 'encaminhado', 'aguardando_outro'],
    [
      'projeto + 4d + idle',
      task({ project_id: 'P', touched_at: FOUR_D }),
      stage,
      [sess('idle')],
      'fila_projeto',
      'parada_no_projeto'
    ],
    ['sem nada', task(), stage, [], 'pendente', null]
  ] as const)('%s', (_n, t, st, ss, group, reason) => {
    const a = attention(t, st, [...ss], NOW)
    expect(a.group).toBe(group)
    expect(a.reason?.kind ?? null).toBe(reason)
  })

  it('projeto + 4d + sessão working fica em pendente com faded', () => {
    const a = attention(
      task({ project_id: 'P', touched_at: FOUR_D }),
      stage,
      [sess('working')],
      NOW
    )
    expect(a.group).toBe('pendente')
    expect(a.faded).toBe(true)
  })

  it.each([['atribuida'], ['desbloqueada']] as const)('turn_reason %s', (r) => {
    const a = attention(task({ turn_reason: r, turn_at: iso(-2 * H) }), stage, [], NOW)
    expect(a.group).toBe('sua_vez')
    expect(a.reason).toEqual({ kind: r, since: iso(-2 * H) })
  })
})

describe('attention: sessão', () => {
  it.each([['idle'], ['unknown'], ['working']] as const)('%s sozinha é pendente', (s) => {
    const a = attention(task(), stage, [sess(s)], NOW)
    expect(a.group).toBe('pendente')
    expect(a.reason).toBeNull()
  })

  it('waiting encerrada não conta', () => {
    const a = attention(task(), stage, [sess('waiting', { ended_at: iso(-H) })], NOW)
    expect(a.group).toBe('pendente')
  })

  it('pickSession prefere waiting a idle', () => {
    const w = sess('waiting')
    expect(pickSession([sess('idle'), w])).toBe(w)
  })

  it('pickSession segue waiting > working > idle > unknown e desempata pelo state_at mais antigo', () => {
    const u = sess('unknown')
    const i = sess('idle')
    expect(pickSession([u, i])).toBe(i)
    const w = sess('working')
    expect(pickSession([i, w])).toBe(w)
    const old = sess('waiting', { state_at: '2026-10-22T08:00:00.000Z' })
    const nw = sess('waiting', { state_at: '2026-10-22T09:00:00.000Z' })
    expect(pickSession([nw, old])).toBe(old)
  })

  it('pickSession devolve a mesma linha (genérico) e null sem vivas', () => {
    const row = { ...sess('idle'), id: 'S1', tool: 'claude' }
    expect(pickSession([row])?.id).toBe('S1')
    expect(pickSession([sess('waiting', { ended_at: iso(-H) })])).toBeNull()
    expect(pickSession([])).toBeNull()
  })
})

describe('attention: 3 dias', () => {
  it('exatamente 72 h não é faded', () => {
    expect(attention(task({ touched_at: iso(-3 * DAY_MS) }), stage, [], NOW).faded).toBe(false)
  })
  it('72 h + 1 ms é faded', () => {
    expect(attention(task({ touched_at: iso(-3 * DAY_MS - 1) }), stage, [], NOW).faded).toBe(true)
  })
  it('exatamente 72 h com projeto continua pendente', () => {
    const a = attention(task({ project_id: 'P', touched_at: iso(-3 * DAY_MS) }), stage, [], NOW)
    expect(a.group).toBe('pendente')
  })
  it('sem projeto nunca vira fila_projeto', () => {
    const a = attention(task({ touched_at: FOUR_D }), stage, [], NOW)
    expect(a.group).toBe('pendente')
    expect(a.faded).toBe(true)
  })
  it('faded só em pendente', () => {
    const a = attention(
      task({ touched_at: FOUR_D, blocked_reason: 'x', blocked_at: FOUR_D }),
      stage,
      [],
      NOW
    )
    expect(a.faded).toBe(false)
  })
})

describe('attention: since', () => {
  it('sessao_aguardando usa o mais antigo entre state_at e turn_at', () => {
    const a = attention(
      task({ turn_reason: 'voltou', turn_at: '2026-10-22T09:00:00.000Z' }),
      stage,
      [sess('waiting', { state_at: '2026-10-22T10:00:00.000Z' })],
      NOW
    )
    expect(a.reason).toEqual({ kind: 'sessao_aguardando', since: '2026-10-22T09:00:00.000Z' })
  })
  it('sessao_aguardando sem turn_at usa state_at', () => {
    const a = attention(task(), stage, [sess('waiting')], NOW)
    expect(a.reason?.since).toBe('2026-10-22T10:00:00.000Z')
  })
  it('bloqueada usa blocked_at; aguardando_outro e parada_no_projeto usam touched_at', () => {
    expect(
      attention(task({ blocked_reason: 'x', blocked_at: iso(-5 * H) }), stage, [], NOW).reason
        ?.since
    ).toBe(iso(-5 * H))
    expect(attention(task({ touched_at: iso(-7 * H) }), waitsOther, [], NOW).reason?.since).toBe(
      iso(-7 * H)
    )
    expect(
      attention(task({ project_id: 'P', touched_at: FOUR_D }), stage, [], NOW).reason?.since
    ).toBe(FOUR_D)
  })
})

describe('attention: sort_key', () => {
  const key = (t: AttTask, st = stage, ss: AttSession[] = [], rank?: string | null): string =>
    attention(t, st, ss, NOW, rank).sort_key
  const sorted = (keys: string[]): string[] => [...keys].sort()

  it('sua_vez: a mais antiga primeiro', () => {
    const older = key(task({ id: 'A', turn_reason: 'atribuida', turn_at: iso(-5 * H) }))
    const newer = key(task({ id: 'B', turn_reason: 'atribuida', turn_at: iso(-1 * H) }))
    expect(sorted([newer, older])).toEqual([older, newer])
  })

  it('encaminhado: bloqueada (mesmo recente) antes de aguardando outro; bloqueadas por blocked_at', () => {
    const bOld = key(task({ id: 'A', blocked_reason: 'x', blocked_at: iso(-5 * H) }))
    const bNew = key(task({ id: 'B', blocked_reason: 'x', blocked_at: iso(-1 * H) }))
    const wait = key(task({ id: 'C', touched_at: iso(-10 * DAY_MS) }), waitsOther)
    expect(sorted([wait, bNew, bOld])).toEqual([bOld, bNew, wait])
  })

  it('pendente: touched_at mais novo primeiro', () => {
    const newer = key(task({ id: 'A', touched_at: iso(-1 * H) }))
    const older = key(task({ id: 'B', touched_at: iso(-2 * H) }))
    expect(sorted([older, newer])).toEqual([newer, older])
  })

  it('empate de tempo desempata por id, de forma estável', () => {
    const a = key(task({ id: 'A' }))
    const b = key(task({ id: 'B' }))
    expect(sorted([b, a])).toEqual([a, b])
    expect(key(task({ id: 'A' }))).toBe(a)
  })

  it('formato: epoch 13 dígitos, invertido no pendente', () => {
    const e = NOW.getTime() - H
    expect(key(task())).toBe(`${String(9999999999999 - e)}|T1`)
    expect(key(task({ turn_reason: 'voltou', turn_at: iso(-H) }))).toBe(
      `${String(e).padStart(13, '0')}|T1`
    )
  })

  it('fila_projeto: project_id|rank|id, rank ausente vira ~', () => {
    const t = task({ project_id: 'P', touched_at: FOUR_D })
    expect(key(t, stage, [], 'a0')).toBe('P|a0|T1')
    expect(key(t, stage, [], null)).toBe('P|~|T1')
    expect(key(t)).toBe('P|~|T1')
  })

  it('concluida: done_at mais novo primeiro', () => {
    const e = NOW.getTime() - H
    expect(key(task({ done_at: iso(-H) }))).toBe(`${String(9999999999999 - e)}|T1`)
  })
})

describe('attention: campos de data ausentes', () => {
  it('turn_reason com turn_at null usa touched_at, sem NaN', () => {
    const a = attention(task({ turn_reason: 'atribuida', turn_at: null }), stage, [], NOW)
    expect(a.reason).toEqual({ kind: 'atribuida', since: iso(-H) })
    expect(a.sort_key).not.toContain('NaN')
  })
  it('blocked_reason com blocked_at null usa touched_at, sem NaN', () => {
    const a = attention(task({ blocked_reason: 'x', blocked_at: null }), stage, [], NOW)
    expect(a.reason).toEqual({ kind: 'bloqueada', since: iso(-H) })
    expect(a.sort_key).not.toContain('NaN')
  })
  it('blocked_reason e waits_other juntos dão bloqueada', () => {
    const a = attention(task({ blocked_reason: 'x', blocked_at: iso(-H) }), waitsOther, [], NOW)
    expect(a.reason?.kind).toBe('bloqueada')
  })
})
