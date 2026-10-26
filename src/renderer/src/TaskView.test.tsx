// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { Live } from './App'
import { fakeApi, stubResizeObserver, taskDetail, taskRow } from './testing/fakeApi'
import { TaskView } from './TaskView'

// O xterm real não roda no jsdom: o registro de terminais vira um Map de mentira.
const fakeTerms = vi.hoisted(() => {
  const made = new Set<string>()
  const disposed: string[] = []
  const entry = (id: string): unknown => {
    made.add(id)
    return {
      term: { cols: 80, rows: 24, focus: () => undefined, write: () => undefined },
      fit: { fit: () => undefined },
      el: document.createElement('div'),
      ref: { id }
    }
  }
  return { made, disposed, entry }
})
vi.mock('./terms', () => ({
  hasTerm: (id: string) => fakeTerms.made.has(id),
  getTerm: (id: string) => fakeTerms.entry(id),
  attachTerm: (id: string) => fakeTerms.entry(id),
  disposeTerm: (id: string) => {
    fakeTerms.disposed.push(id)
    fakeTerms.made.delete(id)
  }
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => {
  act(() => root.render(<></>))
  fakeTerms.made.clear()
  fakeTerms.disposed.length = 0
})
beforeAll(stubResizeObserver)

const ID = '01JTASKVIEW000000000000000'
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
}
const button = (text: string | RegExp): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')
  )
const menu = (label: string): void => {
  act(() => button('⋯')!.click())
  act(() => button(label)!.click())
}

const noLive: Live = { states: {}, alive: new Set(), exited: {} }
const liveOn: Live = { states: { [ID]: 'working' }, alive: new Set([ID]), exited: {} }

async function mount(
  o: {
    live?: Live
    detail?: Parameters<typeof taskDetail>[1]
    over?: Parameters<typeof fakeApi>[1]
  } = {}
): Promise<ReturnType<typeof fakeApi> & { undoable: [string, string][] }> {
  const row = taskRow(ID, 'T-7')
  const fake = fakeApi({ rows: [row], details: { [ID]: taskDetail(row, o.detail) } }, o.over)
  ;(window as unknown as { turnflow: unknown }).turnflow = fake.api
  const undoable: [string, string][] = []
  act(() =>
    root.render(
      <TaskView
        id={ID}
        name={{ key: 'T-7', title: 'title T-7' }}
        live={o.live ?? noLive}
        focused
        draft={false}
        onStarted={() => undefined}
        onEnd={() => undefined}
        onPin={() => undefined}
        onUndoable={(activity, text) => undoable.push([activity, text])}
      />
    )
  )
  await flush()
  return { ...fake, undoable }
}

it('sessão viva: o Registro não oferece nova sessão e tem caminho de volta ao terminal', async () => {
  await mount({
    live: liveOn,
    detail: {
      sessions: [
        {
          id: 'old',
          tool: 'claude-code',
          external_id: 'ext',
          state: 'idle',
          state_at: '2026-10-22T10:00:00.000Z',
          started_at: '2026-10-22T10:00:00.000Z',
          ended_at: '2026-10-22T10:30:00.000Z',
          label: null
        }
      ]
    }
  })
  expect(host.querySelector('.term')).not.toBeNull()
  menu('Record')
  expect(host.querySelector('.timeline')).not.toBeNull()
  expect(button('New session')).toBeUndefined()
  expect(button('Resume')).toBeUndefined()
  act(() => button(/terminal/i)!.click())
  expect(host.querySelector('.term')).not.toBeNull()
})

it('filtro do Registro volta para Tudo', async () => {
  await mount({
    detail: {
      checkpoints: [{ id: 'c1', at: '2026-10-22T10:00:00.000Z', text: 'cp one', source: 'user' }]
    }
  })
  const shown = (): string => host.querySelector('.timeline ol')?.textContent ?? ''
  expect(shown()).toContain('cp one')
  menu('Sessions')
  expect(shown()).not.toContain('cp one')
  act(() => button('All')!.click())
  expect(shown()).toContain('cp one')
})

it('pty_busy no fim das tentativas não destrói o terminal', async () => {
  const fake = fakeApi({})
  const busy = {
    ok: false,
    error: { code: 'CONFLICT', message: 'busy', details: { reason: 'pty_busy' } }
  }
  const view = await mount({
    over: {
      ptySpawn: (async () => {
        // o exit do processo velho chega na hora: o spawnWhenFree tenta de novo sem esperar
        view.emit('onExit', ID, 0)
        return busy
      }) as never
    }
  })
  void fake
  act(() => button('New session')!.click())
  await flush()
  expect(fakeTerms.disposed).toEqual([])
  expect(host.textContent).toContain('busy')
})

it('Encerrar com sessão de fora trabalhando pede confirmação no diálogo do app', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const view = await mount({
    detail: { session: { id: 's', tool: 'claude-code', state: 'working' } }
  })
  menu('Close')
  expect(confirm).not.toHaveBeenCalled()
  expect(host.querySelector('[role="dialog"]')?.textContent).toMatch(/working/i)
  expect(view.calls.some((c) => c.name === 'taskClose')).toBe(false)
  confirm.mockRestore()
})

it('evento de sessão (ids de sessão, não da task) recarrega a visão', async () => {
  const view = await mount()
  const before = view.calls.filter((c) => c.name === 'taskGet').length
  act(() => view.emit('onDomainChanged', { entity: 'session', ids: ['sess-x'], op: 'upsert' }))
  await flush()
  expect(view.calls.filter((c) => c.name === 'taskGet').length).toBeGreaterThan(before)
})

it('editar resumo sem resumo não pré-preenche com o checkpoint', async () => {
  await mount({
    detail: {
      checkpoints: [{ id: 'c1', at: '2026-10-22T10:00:00.000Z', text: 'cp one', source: 'user' }]
    }
  })
  act(() => button('Edit')!.click())
  const fields = [...host.querySelectorAll<HTMLInputElement>('.task-summary input')]
  expect(fields.map((f) => f.value)).toEqual(['', ''])
})

it('clicar na etapa atual não dispara', async () => {
  const view = await mount()
  act(() => button('Doing')!.click())
  await flush()
  expect(view.calls.some((c) => c.name === 'taskSetStage')).toBe(false)
})

it('ação desfazível avisa o app com texto (o toast vive fora da aba)', async () => {
  const view = await mount({
    over: {
      taskUnblock: (async () => ({ ok: true, data: { row: null, activity_id: 'act-1' } })) as never
    },
    detail: { blocked_reason: 'waiting' }
  })
  menu('Unblock')
  await flush()
  expect(view.undoable).toEqual([['act-1', expect.stringMatching(/unblocked/i)]])
})

it('formulário da task fecha no Esc', async () => {
  await mount()
  menu('Block')
  const field = host.querySelector<HTMLInputElement>('.task-ask input')!
  act(() => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  expect(host.querySelector('.task-ask')).toBeNull()
})

it('mover mostra o par de etapa sugerido antes de aplicar', async () => {
  const moves: unknown[] = []
  const view = await mount({
    over: {
      projectList: (async () => ({
        ok: true,
        data: [{ id: 'p1', name: 'Site' }]
      })) as never,
      flowList: (async () => ({
        ok: true,
        data: [
          {
            id: 'f2',
            name: 'Other',
            is_default: false,
            stages: [{ id: 'st9', name: 'Review', short_name: 'Rev' }]
          }
        ]
      })) as never,
      taskMove: (async (input: { mapping?: unknown }) => {
        moves.push(input)
        if (!input.mapping)
          return {
            ok: false,
            error: {
              code: 'CONFLICT',
              message: 'remap',
              details: {
                reason: 'remap_required',
                preview: [{ from: { id: 'st1' }, to_stage_id: 'st9' }]
              }
            }
          }
        return { ok: true, data: { row: null, activity_id: 'act-m' } }
      }) as never
    }
  })
  menu('Move')
  await flush()
  act(() => button('Site')!.click())
  await flush()
  expect(moves).toHaveLength(1)
  expect(host.querySelector('.task-ask')?.textContent).toMatch(/Doing.*Rev/)
  act(() => button('Move')!.click())
  await flush()
  expect(moves.at(-1)).toMatchObject({ project_id: 'p1', choice: 'adopt', mapping: { st1: 'st9' } })
  expect(view.undoable).toEqual([['act-m', 'Task moved']])
})
