import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tmpDir } from '../core/testing/db'
import type { Task } from '../shared/types'
import { createLegacyBrain } from './brainDir'
import { loadTasks, watchTasks } from './tasks'

// Leitor herdado com o watchTasks/loadTasks reais e brains sintéticos em pasta temporária.
const brain = (...ids: string[]): string => {
  const root = tmpDir()
  for (const id of ids) readme(root, id)
  return root
}
const readme = (root: string, id: string): void => {
  mkdirSync(join(root, 'current', id), { recursive: true })
  writeFileSync(join(root, 'current', id, 'README.md'), `# ${id} — título\nStatus: em andamento\n`)
}
const ids = (l: Task[]): string[] => l.map((t) => t.id).sort()

let close = (): void => undefined
afterEach(() => close())

const setup = (): {
  lb: ReturnType<typeof createLegacyBrain>
  changed: ReturnType<typeof vi.fn<(l: Task[]) => void>>
  load: ReturnType<typeof vi.fn<(dir: string) => Promise<Task[]>>>
  watch: ReturnType<typeof vi.fn<typeof watchTasks>>
} => {
  const changed = vi.fn<(l: Task[]) => void>()
  const load = vi.fn((dir: string) => loadTasks(dir))
  const watch = vi.fn(watchTasks)
  const lb = createLegacyBrain({ watch, load, onChanged: changed })
  close = () => lb.close()
  return { lb, changed, load, watch }
}

describe('createLegacyBrain', () => {
  it('lista vazia sem pasta', async () => {
    const { lb, changed, watch } = setup()
    await lb.setDir(null)
    expect(lb.list()).toEqual([])
    expect(lb.root()).toBe('')
    expect(watch).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
  })

  it('setDir com pasta nova lista o brain e chama onChanged', async () => {
    const { lb, changed } = setup()
    const root = brain('ABC-1', 'ABC-2')
    await lb.setDir(root)
    expect(ids(lb.list())).toEqual(['ABC-1', 'ABC-2'])
    expect(lb.root()).toBe(root)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(ids(changed.mock.calls[0][0])).toEqual(['ABC-1', 'ABC-2'])
  })

  it('depois do setDir, criar um README novo na pasta nova dispara onChanged de novo', async () => {
    const { lb, changed } = setup()
    const root = brain('ABC-1')
    await lb.setDir(root)
    changed.mockClear()
    readme(root, 'ABC-9')
    await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 5000 })
    expect(ids(lb.list())).toEqual(['ABC-1', 'ABC-9'])
  })

  it('setDir com o mesmo dir não recarrega', async () => {
    const { lb, changed, load, watch } = setup()
    const root = brain('ABC-1')
    await lb.setDir(root)
    await lb.setDir(root)
    expect(load).toHaveBeenCalledTimes(1)
    expect(watch).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('trocar de pasta solta o watcher antigo', async () => {
    const order: string[] = []
    const changed = vi.fn<(l: Task[]) => void>()
    const lb = createLegacyBrain({
      watch: (dir, onChange) => {
        order.push(`watch ${dir}`)
        const off = watchTasks(dir, onChange)
        return () => {
          order.push(`unwatch ${dir}`)
          off()
        }
      },
      load: loadTasks,
      onChanged: changed
    })
    close = () => lb.close()
    const old = brain('ABC-1')
    const next = brain('XYZ-1')
    await lb.setDir(old)
    await lb.setDir(next)
    expect(order).toEqual([`watch ${old}`, `unwatch ${old}`, `watch ${next}`])
    expect(ids(lb.list())).toEqual(['XYZ-1'])
    changed.mockClear()
    readme(old, 'ABC-2')
    await new Promise((r) => setTimeout(r, 800))
    expect(changed).not.toHaveBeenCalled()
    expect(ids(lb.list())).toEqual(['XYZ-1'])
  })

  it('voltar para null esvazia a lista, solta o watcher e avisa', async () => {
    const { lb, changed } = setup()
    const root = brain('ABC-1')
    await lb.setDir(root)
    changed.mockClear()
    await lb.setDir(null)
    expect(lb.list()).toEqual([])
    expect(lb.root()).toBe('')
    expect(changed).toHaveBeenCalledWith([])
    readme(root, 'ABC-2')
    await new Promise((r) => setTimeout(r, 800))
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('leitura da pasta antiga que termina depois da troca é descartada', async () => {
    const pending = new Map<string, (l: Task[]) => void>()
    const changed = vi.fn<(l: Task[]) => void>()
    const lb = createLegacyBrain({
      watch: () => () => undefined,
      load: (dir) => new Promise((res) => pending.set(dir, res)),
      onChanged: changed
    })
    close = () => lb.close()
    const a = lb.setDir('/a')
    const b = lb.setDir('/b')
    pending.get('/b')!([{ id: 'B-1' } as Task])
    await b
    pending.get('/a')!([{ id: 'A-1' } as Task])
    await a
    expect(ids(lb.list())).toEqual(['B-1'])
    expect(changed).toHaveBeenCalledTimes(1)
    expect(lb.root()).toBe('/b')
  })

  it('falha no load vai pro log e não rejeita', async () => {
    const log = vi.fn<(line: string) => void>()
    const lb = createLegacyBrain({
      watch: () => () => undefined,
      load: async () => {
        throw new Error('EACCES brain')
      },
      onChanged: () => undefined,
      log
    })
    close = () => lb.close()
    await expect(lb.setDir('/qualquer')).resolves.toBeUndefined()
    expect(lb.root()).toBe('/qualquer')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('EACCES brain'))
  })

  it('refresh relê a pasta e devolve a lista nova (o refresh do UpdateModal)', async () => {
    const { lb, changed } = setup()
    const root = brain('ABC-1')
    await lb.setDir(root)
    readme(root, 'ABC-7')
    changed.mockClear()
    await lb.refresh()
    expect(ids(lb.list())).toEqual(['ABC-1', 'ABC-7'])
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('refresh sem pasta não faz nada', async () => {
    const { lb, load } = setup()
    await lb.setDir(null)
    await lb.refresh()
    expect(load).not.toHaveBeenCalled()
  })

  it('watch que falhou ao armar: setDir com a mesma pasta rearma', async () => {
    const root = brain('ABC-1')
    let fail = true
    const watch = vi.fn((dir: string, cb: () => void) => {
      if (fail) throw new Error('EMFILE watch')
      return watchTasks(dir, cb)
    })
    const log = vi.fn<(line: string) => void>()
    const lb = createLegacyBrain({
      watch,
      load: (d) => loadTasks(d),
      onChanged: () => undefined,
      log
    })
    close = () => lb.close()
    await expect(lb.setDir(root)).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('EMFILE watch'))
    expect(ids(lb.list())).toEqual(['ABC-1'])
    fail = false
    await lb.setDir(root)
    expect(watch).toHaveBeenCalledTimes(2)
  })
})
