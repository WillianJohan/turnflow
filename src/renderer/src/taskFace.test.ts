import { describe, expect, it } from 'vitest'
import {
  TOAST_MS,
  closeNeedsConfirm,
  headerFace,
  menuItems,
  previousStageId,
  suggestedMapping,
  timelineItems,
  undoToast
} from './taskFace'

const stages = [
  { id: 's1', position: 1 },
  { id: 's2', position: 2 },
  { id: 's3', position: 3 }
]

describe('headerFace', () => {
  it('sem resumo e com checkpoints mostra o último registro e Editar', () => {
    const face = headerFace({
      sum_what: null,
      sum_where: null,
      sum_next: null,
      checkpoints: [
        { at: '2026-10-20T10:00:00.000Z', text: 'older note' },
        { at: '2026-10-22T10:00:00.000Z', text: 'shipped the login fix' }
      ]
    })
    expect(face.lines[0]).toEqual({
      label: 'Last record',
      text: 'shipped the login fix',
      placeholder: true
    })
    expect(face.edit).toBe('Edit')
    expect(face.lines[1].label).toBe('Next')
  })

  it('sem resumo e sem checkpoint mostra que não há resumo', () => {
    const face = headerFace({
      sum_what: null,
      sum_where: '  ',
      sum_next: null,
      checkpoints: []
    })
    expect(face.lines[0].label).toBe('No summary')
    expect(face.lines[0].text).toBe('')
    expect(face.edit).toBe('Edit')
  })

  it('com resumo mostra onde parou e o próximo', () => {
    const face = headerFace({
      sum_what: 'parser accepts empty',
      sum_where: 'src/parse.ts',
      sum_next: 'cover the error path',
      checkpoints: [{ at: '2026-10-22T10:00:00.000Z', text: 'ignored' }]
    })
    expect(face.lines[0]).toEqual({
      label: 'Stopped at',
      text: 'parser accepts empty',
      placeholder: false
    })
    expect(face.lines[1]).toEqual({
      label: 'Next',
      text: 'cover the error path',
      placeholder: false
    })
  })
})

describe('timelineItems', () => {
  it('junta checkpoints e sessões, do mais novo ao mais antigo, e só retoma sessão encerrada com id externo', () => {
    const items = timelineItems({
      checkpoints: [{ id: 'c1', at: '2026-10-21T10:00:00.000Z', text: 'noted' }],
      sessions: [
        {
          id: 'live',
          tool: 'claude-code',
          external_id: 'ext-live',
          started_at: '2026-10-22T12:00:00.000Z',
          ended_at: null,
          label: null
        },
        {
          id: 'done',
          tool: 'codex',
          external_id: 'ext-done',
          started_at: '2026-10-20T12:00:00.000Z',
          ended_at: '2026-10-20T13:00:00.000Z',
          label: 'login'
        },
        {
          id: 'bare',
          tool: 'cursor',
          external_id: null,
          started_at: '2026-10-19T12:00:00.000Z',
          ended_at: '2026-10-19T13:00:00.000Z',
          label: null
        }
      ]
    })
    expect(items.map((item) => item.id)).toEqual(['live', 'c1', 'done', 'bare'])
    expect(items.find((item) => item.id === 'done')).toMatchObject({
      kind: 'session',
      text: 'login',
      resumable: true
    })
    expect(items.find((item) => item.id === 'live')?.resumable).toBe(false)
    expect(items.find((item) => item.id === 'bare')?.resumable).toBe(false)
    expect(items.find((item) => item.id === 'c1')).toMatchObject({
      kind: 'checkpoint',
      resumable: false
    })
  })
})

describe('menuItems', () => {
  it('traz registro, sessões, pasta, etapa anterior, mover, bloquear e encerrar', () => {
    const ids = menuItems(false).map((item) => item.id)
    expect(ids).toEqual([
      'record',
      'sessions',
      'workdir',
      'previous-stage',
      'move',
      'block',
      'close'
    ])
    expect(menuItems(true).map((item) => item.id)).toContain('unblock')
    expect(menuItems(true).map((item) => item.id)).not.toContain('block')
  })

  it('só etapa, mover, bloquear, desbloquear e encerrar desfazem', () => {
    const undo = menuItems(false)
      .filter((item) => item.undo)
      .map((item) => item.id)
    expect(undo).toEqual(['previous-stage', 'move', 'block', 'close'])
    expect(menuItems(true).find((item) => item.id === 'unblock')?.undo).toBe(true)
    expect(menuItems(false).find((item) => item.id === 'workdir')?.undo).toBe(false)
  })
})

describe('previousStageId', () => {
  it('aponta a etapa de posição anterior e nada na primeira', () => {
    expect(previousStageId(stages, 's2')).toBe('s1')
    expect(previousStageId(stages, 's1')).toBeNull()
  })
})

describe('closeNeedsConfirm', () => {
  it('pede confirmação só enquanto a sessão está trabalhando', () => {
    expect(closeNeedsConfirm('working')).toBe(true)
    expect(closeNeedsConfirm('waiting')).toBe(false)
    expect(closeNeedsConfirm(undefined)).toBe(false)
  })
})

describe('suggestedMapping', () => {
  it('usa o par sugerido da etapa atual', () => {
    expect(
      suggestedMapping(
        [
          { from: { id: 's1' }, to_stage_id: 'b1' },
          { from: { id: 's2' }, to_stage_id: null }
        ],
        's1'
      )
    ).toEqual({ s1: 'b1' })
    expect(suggestedMapping([{ from: { id: 's2' }, to_stage_id: null }], 's2')).toBeNull()
  })
})

describe('undoToast', () => {
  it('dura 8 segundos quando a ação devolve activity_id', () => {
    const now = 1_700_000_000_000
    expect(undoToast('act-1', now)).toEqual({ activityId: 'act-1', until: now + TOAST_MS })
    expect(TOAST_MS).toBe(8000)
    expect(undoToast(null, now)).toBeNull()
  })
})
