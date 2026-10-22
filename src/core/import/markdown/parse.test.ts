import { describe, expect, it } from 'vitest'
import { parseDate, parseTaskReadme } from './parse'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'

const brainFormat = [
  '# ABC-1 — Synthetic title',
  '',
  'Status: in progress',
  '',
  '## Description',
  'First paragraph of the description.',
  '',
  '## Acceptance Criteria',
  '- criterion one',
  '',
  '## MRs',
  '- repo => https://example.com/g/r/-/merge_requests/1',
  '',
  '## Sessions',
  `- 2026-01-02 — ${U1} — scope`,
  `- 2026-01-02 — ${U2} — other scope`,
  '',
  '## Checkpoints',
  '- 2026-01-02: first checkpoint',
  '- 2026-01-03: second checkpoint',
  ''
].join('\n')

describe('parseTaskReadme', () => {
  it.each(['## Descrição', '## descricao', '## DESCRIÇÃO', '## Description', '## description'])(
    'cabeçalho %s é a própria descrição (sem o cabeçalho)',
    (heading) => {
      const md = ['# ABC-1 — T', '', heading, '', 'Body line.', '', '## Notes', 'kept'].join('\n')
      expect(parseTaskReadme(md, 'ABC-1').description).toBe('Body line.\n\n## Notes\nkept')
    }
  )

  it('formato do brain', () => {
    const p = parseTaskReadme(brainFormat, 'ABC-1')
    expect(p.key).toBe('ABC-1')
    expect(p.title).toBe('Synthetic title')
    expect(p.status).toBe('in progress')
    expect(p.links).toEqual([
      {
        line: '- repo => https://example.com/g/r/-/merge_requests/1',
        url: 'https://example.com/g/r/-/merge_requests/1'
      }
    ])
    expect(p.sessions).toEqual([
      { at: '2026-01-02T12:00:00.000Z', external_id: U1, label: 'scope' },
      { at: '2026-01-02T12:00:01.000Z', external_id: U2, label: 'other scope' }
    ])
    expect(p.checkpoints).toEqual([
      { at: '2026-01-02T12:00:00.000Z', text: 'first checkpoint' },
      { at: '2026-01-03T12:00:01.000Z', text: 'second checkpoint' }
    ])
    // a seção de descrição é a própria descrição: entra sem o cabeçalho
    expect(p.description).not.toContain('## Description')
    expect(p.description).toMatch(/^First paragraph of the description\.\n\n## Acceptance Criteria/)
    expect(p.description).toContain('## Acceptance Criteria')
    expect(p.description).toContain('- criterion one')
    expect(p.description).not.toContain('## Sessions')
    expect(p.description).not.toContain('## MRs')
    expect(p.description).not.toContain('## Checkpoints')
    expect(p.description).not.toContain('example.com')
  })

  it('CRLF e BOM dão o mesmo resultado', () => {
    const noisy = '\uFEFF' + brainFormat.replace(/\n/g, '\r\n')
    expect(parseTaskReadme(noisy, 'ABC-1')).toEqual(parseTaskReadme(brainFormat, 'ABC-1'))
  })

  it.each([
    ['- 2026-01-02: a', '2026-01-02T12:00:00.000Z'],
    ['- 2026-01-02 — a', '2026-01-02T12:00:00.000Z'],
    ['- **2026-01-02** — a', '2026-01-02T12:00:00.000Z'],
    ['- **2026-01-02:** a', '2026-01-02T12:00:00.000Z'],

    ['- 2026-01-02T08:30:00.000Z — a', '2026-01-02T08:30:00.000Z'],
    ['- 2026-01-02 14:30: a', new Date(2026, 0, 2, 14, 30).toISOString()]
  ])('variações de checkpoint: %s', (line, at) => {
    const p = parseTaskReadme(`## Checkpoints\n${line}\n`, 'ABC-1')
    expect(p.checkpoints).toEqual([{ at, text: 'a' }])
    expect(p.description).toBe('')
  })

  it('qualificador da data entra no texto do checkpoint', () => {
    const p = parseTaskReadme('## Checkpoints\n- 2026-01-02 (afternoon): a\n', 'ABC-1')
    expect(p.checkpoints).toEqual([{ at: '2026-01-02T12:00:00.000Z', text: '(afternoon) a' }])
  })

  it('negrito desbalanceado não deixa ** sobrando', () => {
    const p = parseTaskReadme(
      '## Checkpoints\n- **2026-01-02 — all bold**\n- **2026-01-03:** ok\n',
      'ABC-1'
    )
    expect(p.checkpoints.map((c) => c.text)).toEqual(['all bold', 'ok'])
  })

  it('checkpoint com data e sem texto volta para a descrição', () => {
    const p = parseTaskReadme(
      '## Checkpoints\n- 2026-01-02:\n- 2026-01-03: b\n### 2026-01-04 —\n',
      'ABC-1'
    )
    expect(p.checkpoints).toEqual([{ at: '2026-01-03T12:00:00.000Z', text: 'b' }])
    expect(p.description).toContain('- 2026-01-02:')
    expect(p.description).toContain('### 2026-01-04 —')
  })

  it('CR isolado vira quebra de linha', () => {
    const p = parseTaskReadme('Status: x\r## Checkpoints\r- 2026-01-02: a\r', 'ABC-1')
    expect(p.status).toBe('x')
    expect(p.checkpoints).toHaveLength(1)
  })

  it('cerca só fecha com o mesmo delimitador e tamanho igual ou maior', () => {
    const inside = '## Checkpoints\n- 2026-01-02: a'
    const long = parseTaskReadme(`## Notes\n\`\`\`\`\n\`\`\`\n${inside}\n\`\`\`\`\n`, 'ABC-1')
    expect(long.checkpoints).toEqual([])
    expect(long.description).toContain(inside)
    const tilde = parseTaskReadme(`## Notes\n~~~\n\`\`\`\n${inside}\n~~~\n`, 'ABC-1')
    expect(tilde.checkpoints).toEqual([])
    expect(tilde.description).toContain(inside)
  })

  it('indentação dentro da cerca e na 1ª linha da descrição é preservada', () => {
    const p = parseTaskReadme(
      '    indented first\n## Checkpoints\n- 2026-01-02: a\n  ```\n    code\n  ```\n',
      'ABC-1'
    )
    expect(p.description).toBe('    indented first')
    expect(p.checkpoints[0]?.text).toBe('a\n  ```\n    code\n  ```')
  })

  it('resto da linha de Pai e Branch sem path ficam na descrição', () => {
    const p = parseTaskReadme(
      '**Pai:** ABC-9 (epic text)\n**Branch:** `feat/ABC-1`\n**Worktree:** /tmp/wt\n',
      'ABC-1'
    )
    expect(p.parent).toBe('ABC-9')
    expect(p.workdir_hint).toBe('/tmp/wt')
    expect(p.description).toBe('**Pai:** ABC-9 (epic text)\n**Branch:** `feat/ABC-1`')
  })

  it('texto entre a data e o UUID da sessão vai para o rótulo', () => {
    const p = parseTaskReadme(`## Sessions\n- 2026-01-02 — claude ${U1} — scope\n`, 'ABC-1')
    expect(p.sessions[0]?.label).toBe('claude — scope')
  })

  it('texto do checkpoint que começa em negrito não perde os asteriscos', () => {
    const p = parseTaskReadme('## Checkpoints\n- 2026-01-02 — **bold** start\n', 'ABC-1')
    expect(p.checkpoints[0]?.text).toBe('**bold** start')
  })

  it('checkpoint em várias linhas', () => {
    const p = parseTaskReadme(
      '## Checkpoints\n- 2026-01-02: a\n  continua aqui\nsem marcador\n- 2026-01-03: b\n',
      'ABC-1'
    )
    expect(p.checkpoints.map((c) => c.text)).toEqual(['a\ncontinua aqui\nsem marcador', 'b'])
  })

  it('continuação não vira item dentro de bloco de código', () => {
    const p = parseTaskReadme(
      '## Checkpoints\n- 2026-01-02: a\n  ```\n- 2026-01-09: not an item\n  ```\n',
      'ABC-1'
    )
    expect(p.checkpoints).toHaveLength(1)
    expect(p.checkpoints[0]?.text).toContain('not an item')
  })

  it('### como checkpoint', () => {
    const p = parseTaskReadme(
      '## Checkpoints\n### 2026-01-03 — Partial close\n\nThe body paragraph.\n',
      'ABC-1'
    )
    expect(p.checkpoints).toEqual([
      { at: '2026-01-03T12:00:00.000Z', text: 'Partial close\nThe body paragraph.' }
    ])
  })

  it('### termina no próximo cabeçalho', () => {
    const p = parseTaskReadme(
      '## Checkpoints\n### 2026-01-03 — One\nbody one\n### 2026-01-04 — Two\nbody two\n',
      'ABC-1'
    )
    expect(p.checkpoints.map((c) => c.text)).toEqual(['One\nbody one', 'Two\nbody two'])
  })

  it('seção desconhecida e linha sem data ficam na descrição', () => {
    const p = parseTaskReadme(
      [
        '## Root cause',
        'The cache was stale.',
        '',
        '## Checkpoints',
        'loose intro text',
        '- no date here',
        '- 2026-01-02: dated'
      ].join('\n'),
      'ABC-1'
    )
    expect(p.checkpoints).toEqual([{ at: '2026-01-02T12:00:00.000Z', text: 'dated' }])
    expect(p.description).toContain('## Root cause')
    expect(p.description).toContain('The cache was stale.')
    expect(p.description).toContain('## Checkpoints')
    expect(p.description).toContain('loose intro text')
    expect(p.description).toContain('- no date here')
    expect(p.description).not.toContain('dated')
  })

  it('metadados', () => {
    const p = parseTaskReadme(
      [
        '# ABC-1 - Title with hyphen',
        '**Status:** blocked: waiting vendor',
        '**Pai:** ABC-9',
        '**Worktree:** /tmp/wt/ABC-1',
        '**Project:** Synthetic project',
        '**Type:** Bug',
        '**Blocked:** vendor reply',
        '',
        'Body text.'
      ].join('\n'),
      'ABC-1'
    )
    expect(p).toMatchObject({
      title: 'Title with hyphen',
      status: 'blocked: waiting vendor',
      parent: 'ABC-9',
      workdir_hint: '/tmp/wt/ABC-1',
      project_name: 'Synthetic project',
      type_name: 'Bug',
      blocked: 'vendor reply',
      description: 'Body text.'
    })
  })

  it('Parent em inglês e Branch sem path não dão workdir_hint', () => {
    const p = parseTaskReadme('**Parent:** ABC-2 (epic)\n**Branch:** `feat/ABC-1`\n', 'ABC-1')
    expect(p.parent).toBe('ABC-2')
    expect(p.workdir_hint).toBeNull()
    expect(p.description).toBe('**Parent:** ABC-2 (epic)\n**Branch:** `feat/ABC-1`')
  })

  it('metadado só vale antes do primeiro ##', () => {
    const p = parseTaskReadme('## Notes\nStatus: not metadata\n', 'ABC-1')
    expect(p.status).toBeNull()
    expect(p.description).toContain('Status: not metadata')
  })

  it('descrição crua depois dos metadados, sem cabeçalho (export)', () => {
    const p = parseTaskReadme(
      [
        '# ABC-1 — T',
        'Status: Doing',
        '**Project:** P',
        '',
        'raw line 1',
        '',
        'raw line 2',
        '',
        '## Sessions'
      ].join('\n'),
      'ABC-1'
    )
    expect(p.description).toBe('raw line 1\n\nraw line 2')
    expect(p.project_name).toBe('P')
  })

  it('H1 sem key vira o título inteiro; sem H1 vira a key', () => {
    expect(parseTaskReadme('# Just a title\nbody', 'ABC-1').title).toBe('Just a title')
    expect(parseTaskReadme('body', 'ABC-1').title).toBe('ABC-1')
  })

  it('sem H1 e sem seções', () => {
    const p = parseTaskReadme('só uma linha', 'ABC-1')
    expect(p).toEqual({
      key: 'ABC-1',
      title: 'ABC-1',
      status: null,
      parent: null,
      project_name: null,
      type_name: null,
      blocked: null,
      description: 'só uma linha',
      links: [],
      sessions: [],
      checkpoints: [],
      workdir_hint: null
    })
  })

  it('data inválida', () => {
    const p = parseTaskReadme('## Checkpoints\n- 2026-13-40: x\n', 'ABC-1')
    expect(p.checkpoints).toEqual([])
    expect(p.description).toContain('- 2026-13-40: x')
  })

  it('sessão sem UUID fica na descrição; rótulo vazio vira null', () => {
    const p = parseTaskReadme(
      `## Sessões\n- 2026-01-02 — tool — no uuid\n- 2026-01-03 — ${U1}\n`,
      'ABC-1'
    )
    expect(p.sessions).toEqual([{ at: '2026-01-03T12:00:00.000Z', external_id: U1, label: null }])
    expect(p.description).toContain('- 2026-01-02 — tool — no uuid')
  })

  it('UUID de sessão sai em minúsculas', () => {
    const lower = 'abcdef12-abcd-4bcd-8bcd-abcdef123456'
    const p = parseTaskReadme(`## Sessions\n- 2026-01-02 — ${lower.toUpperCase()} — x\n`, 'ABC-1')
    expect(p.sessions[0]?.external_id).toBe(lower)
  })

  it('links: só linhas com URL, a primeira URL, sem pontuação final', () => {
    const p = parseTaskReadme(
      '## Links\n- see (https://example.com/a/b), also https://example.com/c.\n- no url\n',
      'ABC-1'
    )
    expect(p.links).toEqual([
      {
        line: '- see (https://example.com/a/b), also https://example.com/c.',
        url: 'https://example.com/a/b'
      }
    ])
    expect(p.description).toContain('- no url')
  })

  it('cabeçalho dentro de bloco de código não abre seção', () => {
    const p = parseTaskReadme('## Notes\n```\n## Sessions\n```\n', 'ABC-1')
    expect(p.description).toContain('## Sessions')
    expect(p.sessions).toEqual([])
  })
})

describe('parseDate', () => {
  it('dia sozinho: meio-dia UTC mais o índice em segundos', () => {
    expect(parseDate('2026-01-02', 0)).toBe('2026-01-02T12:00:00.000Z')
    expect(parseDate('2026-01-02', 61)).toBe('2026-01-02T12:01:01.000Z')
  })
  it('o índice nunca empurra o dia (teto 43199 s)', () => {
    expect(parseDate('2026-01-02', 50_000)).toBe('2026-01-02T23:59:59.000Z')
  })
  it('ISO com Z ou offset é exato e ignora o índice', () => {
    expect(parseDate('2026-01-02T08:30:00.000Z', 5)).toBe('2026-01-02T08:30:00.000Z')
    expect(parseDate('2026-01-02T08:30:00-03:00', 5)).toBe('2026-01-02T11:30:00.000Z')
  })
  it('data e hora sem zona é hora local', () => {
    expect(parseDate('2026-01-02 14:30', 3)).toBe(new Date(2026, 0, 2, 14, 30).toISOString())
  })
  it.each(['2026-13-40', '2026-02-30', '2026-01-02 25:00', '2026-01-02T08:30:00+25:00', 'abc', ''])(
    'inválida: %s',
    (s) => {
      expect(parseDate(s, 0)).toBeNull()
    }
  )
})
