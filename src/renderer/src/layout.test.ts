import { describe, expect, it } from 'vitest'
import { BRAND } from '../../shared/brand'
import {
  EMPTY,
  Layout,
  reduce,
  loadLayout,
  scratchId,
  scratchKind,
  windowTitle,
  SETTINGS,
  HOME,
  tabLabel
} from './layout'

const L = (panels: [string[], number][], focused = 0): Layout => ({
  panels: panels.map(([tabs, active]) => ({ tabs, active })),
  focused
})

describe('reduce', () => {
  it('open em layout vazio cria o painel 0', () => {
    expect(reduce(EMPTY, { t: 'open', taskId: 'A' })).toEqual(L([[['A'], 0]]))
  })
  it('open nova vai pro painel focado como aba ativa', () => {
    expect(
      reduce(
        L(
          [
            [['A'], 0],
            [['B'], 0]
          ],
          1
        ),
        { t: 'open', taskId: 'C' }
      )
    ).toEqual(
      L(
        [
          [['A'], 0],
          [['B', 'C'], 1]
        ],
        1
      )
    )
  })
  it('open de task já aberta foca sem duplicar', () => {
    expect(
      reduce(
        L(
          [
            [['A'], 0],
            [['B', 'C'], 0]
          ],
          0
        ),
        { t: 'open', taskId: 'C' }
      )
    ).toEqual(
      L(
        [
          [['A'], 0],
          [['B', 'C'], 1]
        ],
        1
      )
    )
  })
  it('close da última aba remove o painel e ajusta focused', () => {
    expect(
      reduce(
        L(
          [
            [['A'], 0],
            [['B'], 0]
          ],
          1
        ),
        { t: 'close', taskId: 'B' }
      )
    ).toEqual(L([[['A'], 0]], 0))
    expect(
      reduce(
        L(
          [
            [['A'], 0],
            [['B'], 0]
          ],
          1
        ),
        { t: 'close', taskId: 'A' }
      )
    ).toEqual(L([[['B'], 0]], 0))
  })
  it('close da aba ativa no fim recua o active', () => {
    expect(reduce(L([[['A', 'B'], 1]]), { t: 'close', taskId: 'B' })).toEqual(L([[['A'], 0]]))
  })
  it('close de tudo volta ao vazio', () => {
    expect(reduce(L([[['A'], 0]]), { t: 'close', taskId: 'A' })).toEqual(EMPTY)
  })
  it('split cria painel vazio à direita e foca', () => {
    expect(
      reduce(
        L(
          [
            [['A'], 0],
            [['B'], 0]
          ],
          0
        ),
        { t: 'split' }
      )
    ).toEqual(
      L(
        [
          [['A'], 0],
          [[], 0],
          [['B'], 0]
        ],
        1
      )
    )
    expect(reduce(EMPTY, { t: 'split' })).toEqual(L([[[], 0]]))
  })
  it('dropPanel remove painel (vazio ou não)', () => {
    expect(
      reduce(
        L(
          [
            [['A'], 0],
            [[], 0]
          ],
          1
        ),
        { t: 'dropPanel', panel: 1 }
      )
    ).toEqual(L([[['A'], 0]], 0))
  })
  it('focusPanel limita nas bordas', () => {
    expect(
      reduce(
        L(
          [
            [['A'], 0],
            [['B'], 0]
          ],
          1
        ),
        { t: 'focusPanel', dir: 1 }
      ).focused
    ).toBe(1)
    expect(
      reduce(
        L(
          [
            [['A'], 0],
            [['B'], 0]
          ],
          1
        ),
        { t: 'focusPanel', dir: -1 }
      ).focused
    ).toBe(0)
  })
  it('focusAt foca painel por índice e ignora inválido', () => {
    const l = L([
      [['A'], 0],
      [[], 0]
    ])
    expect(reduce(l, { t: 'focusAt', panel: 1 }).focused).toBe(1)
    expect(reduce(l, { t: 'focusAt', panel: 7 })).toBe(l)
  })
  it('focusTab é 1-based e ignora fora do intervalo', () => {
    const l = L([[['A', 'B'], 0]])
    expect(reduce(l, { t: 'focusTab', n: 2 }).panels[0].active).toBe(1)
    expect(reduce(l, { t: 'focusTab', n: 5 })).toBe(l)
  })
  it('cycleTab dá a volta', () => {
    expect(reduce(L([[['A', 'B'], 1]]), { t: 'cycleTab', dir: 1 }).panels[0].active).toBe(0)
    expect(reduce(L([[['A', 'B'], 0]]), { t: 'cycleTab', dir: -1 }).panels[0].active).toBe(1)
  })
  it('move tira da origem e põe no destino', () => {
    expect(
      reduce(
        L([
          [['A', 'B'], 0],
          [['C'], 0]
        ]),
        { t: 'move', taskId: 'B', toPanel: 1 }
      )
    ).toEqual(
      L(
        [
          [['A'], 0],
          [['C', 'B'], 1]
        ],
        1
      )
    )
    // origem esvazia e some: índice do destino recua
    expect(
      reduce(
        L([
          [['A'], 0],
          [['C'], 0]
        ]),
        { t: 'move', taskId: 'A', toPanel: 1 }
      )
    ).toEqual(L([[['C', 'A'], 1]], 0))
  })
  it('retain mantém abas avulsas (~claude, ~shell), que não são task', () => {
    expect(reduce(L([[['A', '~shell-1'], 1]]), { t: 'retain', ids: new Set(['A']) })).toEqual(
      L([[['A', '~shell-1'], 1]])
    )
  })
  it('retain remove abas de tasks que sumiram', () => {
    expect(reduce(L([[['A', 'X'], 1]]), { t: 'retain', ids: new Set(['A']) })).toEqual(
      L([[['A'], 0]])
    )
  })
})

describe('restore', () => {
  it('troca o layout inteiro e limita foco e aba ativa', () => {
    expect(
      reduce(EMPTY, {
        t: 'restore',
        layout: { panels: [{ tabs: ['A', 'B'], active: 9 }], focused: 4 }
      })
    ).toEqual(L([[['A', 'B'], 1]], 0))
  })
})

describe('loadLayout', () => {
  it('JSON inválido vira EMPTY', () => {
    expect(loadLayout('{lixo')).toEqual(EMPTY)
    expect(loadLayout(null)).toEqual(EMPTY)
    expect(loadLayout('{"panels":"x"}')).toEqual(EMPTY)
  })
})

describe('abas avulsas', () => {
  it('id novo não repete os já abertos', () => {
    expect(scratchId('shell', L([[['~shell-1', '~shell-2'], 0]]))).toBe('~shell-3')
    expect(scratchId('claude', EMPTY)).toBe('~claude-1')
  })
  it('pula id de processo que ainda está morrendo (xterm velho no mapa)', () => {
    expect(scratchId('shell', EMPTY, new Set(['~shell-1']))).toBe('~shell-2')
  })
  it('tipo pelo id', () => {
    expect(scratchKind('~claude-2')).toBe('claude')
    expect(scratchKind('~shell-1')).toBe('shell')
    expect(scratchKind('T-1')).toBeNull()
  })
})

describe('splitMove (soltar a aba na borda)', () => {
  it('aba solta à direita do próprio painel abre painel novo ao lado', () => {
    expect(
      reduce(L([[['A', 'B'], 1]]), { t: 'splitMove', taskId: 'B', panel: 0, side: 1 })
    ).toEqual(
      L(
        [
          [['A'], 0],
          [['B'], 0]
        ],
        1
      )
    )
  })
  it('origem que esvazia some e o índice do alvo acompanha', () => {
    expect(
      reduce(
        L([
          [['A'], 0],
          [['C'], 0]
        ]),
        { t: 'splitMove', taskId: 'A', panel: 1, side: -1 }
      )
    ).toEqual(
      L(
        [
          [['A'], 0],
          [['C'], 0]
        ],
        0
      )
    )
    expect(
      reduce(
        L([
          [['A'], 0],
          [['C'], 0]
        ]),
        { t: 'splitMove', taskId: 'A', panel: 1, side: 1 }
      )
    ).toEqual(
      L(
        [
          [['C'], 0],
          [['A'], 0]
        ],
        1
      )
    )
  })
  it('única aba no único painel: nada a dividir', () => {
    const l = L([[['A'], 0]])
    expect(reduce(l, { t: 'splitMove', taskId: 'A', panel: 0, side: 1 })).toBe(l)
  })
})

describe('windowTitle', () => {
  it('abas ativas dos painéis, na ordem', () => {
    expect(
      windowTitle(
        L([
          [['T-1', 'T-2'], 1],
          [['~shell-1'], 0]
        ])
      )
    ).toBe(`T-2 │ Terminal 1 — ${BRAND.name}`)
    expect(windowTitle(EMPTY)).toBe(BRAND.name)
  })
})

describe('aba prévia (igual VS Code)', () => {
  const P = (tabs: string[], active: number, preview?: string): Layout => ({
    panels: [{ tabs, active, preview }],
    focused: 0
  })

  it('peek em layout vazio abre como prévia', () => {
    expect(reduce(EMPTY, { t: 'peek', taskId: 'A' })).toEqual(P(['A'], 0, 'A'))
  })
  it('peek seguinte substitui a prévia no mesmo lugar', () => {
    expect(reduce(P(['X', 'A', 'Y'], 1, 'A'), { t: 'peek', taskId: 'B' })).toEqual(
      P(['X', 'B', 'Y'], 1, 'B')
    )
  })
  it('peek sem prévia no painel acrescenta como prévia', () => {
    expect(reduce(P(['X'], 0), { t: 'peek', taskId: 'B' })).toEqual(P(['X', 'B'], 1, 'B'))
  })
  it('peek de task já aberta só foca, sem mexer em prévia', () => {
    expect(reduce(P(['X', 'A'], 1, 'A'), { t: 'peek', taskId: 'X' })).toEqual(P(['X', 'A'], 0, 'A'))
  })
  it('open (clique duplo) fixa a prévia', () => {
    expect(reduce(P(['A'], 0, 'A'), { t: 'open', taskId: 'A' })).toEqual(P(['A'], 0, undefined))
  })
  it('pin fixa sem mudar o foco', () => {
    expect(reduce(P(['X', 'A'], 0, 'A'), { t: 'pin', taskId: 'A' })).toEqual(
      P(['X', 'A'], 0, undefined)
    )
  })
  it('fechar a prévia limpa a marca', () => {
    expect(reduce(P(['X', 'A'], 1, 'A'), { t: 'close', taskId: 'A' })).toEqual(
      P(['X'], 0, undefined)
    )
  })
  it('arrastar a prévia pra outro painel fixa', () => {
    const l: Layout = {
      panels: [
        { tabs: ['X', 'A'], active: 1, preview: 'A' },
        { tabs: ['C'], active: 0 }
      ],
      focused: 0
    }
    const r = reduce(l, { t: 'move', taskId: 'A', toPanel: 1 })
    expect(r.panels.map((p) => p.preview)).toEqual([undefined, undefined])
  })
})

describe('aba de configurações', () => {
  it('é única, sobrevive ao retain e tem rótulo', () => {
    const l = reduce(reduce(EMPTY, { t: 'open', taskId: SETTINGS }), {
      t: 'open',
      taskId: SETTINGS
    })
    expect(l.panels[0].tabs).toEqual([SETTINGS])
    expect(reduce(l, { t: 'retain', ids: new Set() }).panels[0].tabs).toEqual([SETTINGS])
    expect(tabLabel(SETTINGS)).toBe('Configurações')
    expect(
      reduce(reduce(EMPTY, { t: 'open', taskId: HOME }), { t: 'retain', ids: new Set() }).panels[0]
        .tabs
    ).toEqual([HOME])
    expect(tabLabel(HOME)).toBe('Home')
  })
})

describe('rename (aba avulsa adotada pela task)', () => {
  it('troca o id no lugar e mantém a aba ativa', () => {
    expect(
      reduce(L([[['T-1', '~claude-1'], 1]]), { t: 'rename', from: '~claude-1', to: 'T-5024' })
    ).toEqual(L([[['T-1', 'T-5024'], 1]]))
  })
  it('se a task já estava aberta (README), a aba velha dela sai', () => {
    const l: Layout = {
      panels: [
        { tabs: ['T-5024', 'X'], active: 1 },
        { tabs: ['~claude-1'], active: 0 }
      ],
      focused: 1
    }
    const r = reduce(l, { t: 'rename', from: '~claude-1', to: 'T-5024' })
    expect(r.panels.map((p) => p.tabs)).toEqual([['X'], ['T-5024']])
    expect(r.focused).toBe(1)
  })
})

describe('tamanho dos painéis', () => {
  const two = (): Layout => ({
    panels: [
      { tabs: ['A'], active: 0 },
      { tabs: ['B'], active: 0 }
    ],
    focused: 0
  })
  it('resizePair grava o peso dos dois vizinhos', () => {
    const r = reduce(two(), { t: 'resizePair', panel: 0, a: 1.2, b: 0.8 })
    expect(r.panels.map((p) => p.size)).toEqual([1.2, 0.8])
  })
  it('equalize volta todos pro mesmo tamanho', () => {
    const r = reduce(reduce(two(), { t: 'resizePair', panel: 0, a: 1.5, b: 0.5 }), {
      t: 'equalize'
    })
    expect(r.panels.map((p) => p.size)).toEqual([undefined, undefined])
  })
  it('resizePair inválido não muda nada', () => {
    const l = two()
    expect(reduce(l, { t: 'resizePair', panel: 1, a: 1, b: 1 })).toBe(l)
  })
})

it('fechar/abrir aba não perde o tamanho do painel', () => {
  let l: Layout = {
    panels: [
      { tabs: ['A', 'B'], active: 0, size: 1.5 },
      { tabs: ['C'], active: 0, size: 0.5 }
    ],
    focused: 0
  }
  l = reduce(l, { t: 'close', taskId: 'B' })
  l = reduce(l, { t: 'peek', taskId: 'D' })
  expect(l.panels.map((p) => p.size)).toEqual([1.5, 0.5])
})
