import { Limits } from '../shared/contracts'
import { rename } from 'fs/promises'
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  DEFAULT_CONFIG,
  cloneTheme,
  ensureDefaults,
  listThemes,
  readConfig,
  readTheme,
  writeConfig,
  watchConfig,
  parseFcList,
  saveTheme,
  DEFAULT_THEME
} from './appConfig'

const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'dkc-'))

describe('ensureDefaults', () => {
  it('cria config.json e os temas escuro/claro', async () => {
    const d = await tmp()
    await ensureDefaults(d)
    expect(JSON.parse(await readFile(join(d, 'config.json'), 'utf8'))).toEqual(DEFAULT_CONFIG)
    expect((await listThemes(d)).map((t) => t.id).sort()).toEqual([
      'catppuccin-mocha',
      'claro',
      'darkest',
      'dracula',
      'escuro',
      'gruvbox',
      'nord',
      'one-dark',
      'orange-dark',
      'orange-light',
      'rose-pine-dawn',
      'tokyo-night'
    ])
  })
  it('nunca sobrescreve o que o usuário editou', async () => {
    const d = await tmp()
    await ensureDefaults(d)
    await writeFile(
      join(d, 'themes/escuro.json'),
      JSON.stringify({ name: 'Meu escuro', ui: { bg: '#000000' } })
    )
    await ensureDefaults(d)
    expect((await readTheme(d, 'escuro')).theme.name).toBe('Meu escuro')
  })
})

describe('readConfig / writeConfig', () => {
  it('JSON quebrado volta pros padrões com erro legível', async () => {
    const d = await tmp()
    await writeFile(join(d, 'config.json'), '{ "theme": ')
    const r = await readConfig(d)
    expect(r.config).toEqual(DEFAULT_CONFIG)
    expect(r.error).toMatch(/config\.json/)
  })
  it('campo faltando usa o padrão; write mescla', async () => {
    const d = await tmp()
    await writeFile(join(d, 'config.json'), JSON.stringify({ theme: 'claro' }))
    expect((await readConfig(d)).config).toEqual({ ...DEFAULT_CONFIG, theme: 'claro' })
    await writeConfig(d, { draftMode: true })
    expect((await readConfig(d)).config).toEqual({
      ...DEFAULT_CONFIG,
      theme: 'claro',
      draftMode: true
    })
  })
})

describe('readTheme', () => {
  it('chave faltando no tema cai no escuro padrão', async () => {
    const d = await tmp()
    await ensureDefaults(d)
    await writeFile(
      join(d, 'themes/meu.json'),
      JSON.stringify({ name: 'Meu', ui: { accent: '#ff0000' } })
    )
    const { theme, error } = await readTheme(d, 'meu')
    expect(error).toBeUndefined()
    expect(theme.ui.accent).toBe('#ff0000')
    expect(theme.ui.bg).toBe('#14161a')
    expect(theme.terminal.background).toBe('#14161a')
  })
  it('tema inexistente ou quebrado → escuro com erro', async () => {
    const d = await tmp()
    await ensureDefaults(d)
    await writeFile(join(d, 'themes/ruim.json'), '{')
    expect((await readTheme(d, 'ruim')).error).toMatch(/ruim\.json/)
    expect((await readTheme(d, 'nao-existe')).theme.name).toBe('Escuro')
  })
  it('id com ../ não sai da pasta de temas', async () => {
    const d = await tmp()
    await ensureDefaults(d)
    expect((await readTheme(d, '../config')).error).toBeTruthy()
  })
})

describe('cloneTheme', () => {
  it('copia o tema com nome novo sem colidir', async () => {
    const d = await tmp()
    await ensureDefaults(d)
    const a = await cloneTheme(d, 'claro')
    const b = await cloneTheme(d, 'claro')
    expect(a).toBe('claro-personalizado')
    expect(b).toBe('claro-personalizado-2')
    expect((await readTheme(d, b)).theme.ui.bg).toBe('#ffffff')
  })
})

describe('proteção do config.json', () => {
  it('config.json quebrado não é sobrescrito pelos padrões', async () => {
    const d = await tmp()
    await writeFile(join(d, 'config.json'), '{ "theme": "claro", "extra": 1, }')
    await expect(writeConfig(d, { draftMode: true })).rejects.toThrow(/config\.json/)
    expect(await readFile(join(d, 'config.json'), 'utf8')).toBe('{ "theme": "claro", "extra": 1, }')
  })
  it('fontes: padrão quando ausente, valor quando string', async () => {
    const d = await tmp()
    await writeFile(
      join(d, 'config.json'),
      JSON.stringify({ termFont: 'Fira Code', appFontSize: 'x' })
    )
    const c = (await readConfig(d)).config
    expect(c.termFont).toBe('Fira Code')
    expect(c.appFont).toBe(DEFAULT_CONFIG.appFont)
    expect(c.appFontSize).toBe(DEFAULT_CONFIG.appFontSize)
  })
  it('ícone de status: o do usuário vence, o resto vem do padrão, valor não-texto é ignorado', async () => {
    const d = await tmp()
    await writeFile(
      join(d, 'config.json'),
      JSON.stringify({ statusIcons: { GMUD: '🛫', Bloqueado: 3 } })
    )
    const icons = (await readConfig(d)).config.statusIcons
    expect(icons.GMUD).toBe('🛫')
    expect(icons.Bloqueado).toBe(DEFAULT_CONFIG.statusIcons.Bloqueado)
    expect(Object.keys(icons)).toEqual(Object.keys(DEFAULT_CONFIG.statusIcons))
  })
  it('notificações ligadas por padrão; false desliga', async () => {
    const d = await tmp()
    await writeFile(join(d, 'config.json'), JSON.stringify({ notifications: false }))
    expect((await readConfig(d)).config.notifications).toBe(false)
    expect(DEFAULT_CONFIG.notifications).toBe(true)
  })
  it('tipo errado cai no padrão em vez de quebrar', async () => {
    const d = await tmp()
    await writeFile(
      join(d, 'config.json'),
      JSON.stringify({ theme: 5, draftMode: 'sim', fontSize: 'x' })
    )
    expect((await readConfig(d)).config).toEqual(DEFAULT_CONFIG)
  })
  it('agents inválido volta ao padrão por campo', async () => {
    expect(DEFAULT_CONFIG.agents).toEqual({ codex: 'codex', cursor: 'cursor-agent', other: null })
    const d = await tmp()
    await writeFile(
      join(d, 'config.json'),
      JSON.stringify({
        agents: { codex: 5, cursor: 'x'.repeat(1025), other: false, extra: 'no' }
      })
    )
    expect((await readConfig(d)).config.agents).toEqual(DEFAULT_CONFIG.agents)
    await writeFile(
      join(d, 'config.json'),
      JSON.stringify({ agents: { codex: 'my-codex', cursor: 'cursor-agent', other: 'my-ai' } })
    )
    expect((await readConfig(d)).config.agents).toEqual({
      codex: 'my-codex',
      cursor: 'cursor-agent',
      other: 'my-ai'
    })
    await writeFile(join(d, 'config.json'), JSON.stringify({ agents: { other: null } }))
    expect((await readConfig(d)).config.agents.other).toBeNull()
    expect((await readConfig(d)).config.agents.codex).toBe('codex')
  })
  it('pasta padrão: só caminho absoluto; relativo ou não-texto vira null', async () => {
    expect(DEFAULT_CONFIG.defaultWorkdir).toBeNull()
    const d = await tmp()
    const read = async (v: unknown): Promise<string | null> => {
      await writeFile(join(d, 'config.json'), JSON.stringify({ defaultWorkdir: v }))
      return (await readConfig(d)).config.defaultWorkdir
    }
    expect(await read('rel/x')).toBeNull()
    expect(await read(5)).toBeNull()
    expect(await read('/abs')).toBe('/abs')
    expect(await read('/' + 'a'.repeat(Limits.workdir))).toBeNull()
  })
})

describe('watchConfig', () => {
  it('continua avisando depois de saves por rename (vim/gedit)', async () => {
    const d = await tmp()
    await ensureDefaults(d)
    let n = 0
    const stop = watchConfig(d, () => n++)
    const save = async (v: string): Promise<void> => {
      await writeFile(join(d, 'config.json.tmp'), v)
      await rename(join(d, 'config.json.tmp'), join(d, 'config.json'))
      await new Promise((r) => setTimeout(r, 400))
    }
    await save('{"theme":"claro"}')
    const first = n
    await save('{"theme":"escuro"}')
    stop()
    expect(first).toBeGreaterThan(0)
    expect(n).toBeGreaterThan(first)
  })
})

describe('parseFcList', () => {
  it('primeiro nome de cada linha, sem repetir, em ordem', () => {
    expect(parseFcList('Fira Code,Fira Code Light\nDejaVu Sans Mono\n\nFira Code\n')).toEqual([
      'DejaVu Sans Mono',
      'Fira Code'
    ])
  })
})

describe('temas padrão novos', () => {
  it('darkest é preto e orange-* tem destaque e seleção laranja', async () => {
    const d = await tmp()
    await ensureDefaults(d)
    expect((await readTheme(d, 'darkest')).theme.ui.bg).toBe('#0d1117')
    for (const id of ['orange-dark', 'orange-light']) {
      const t = (await readTheme(d, id)).theme
      expect(t.ui.accent).toMatch(/^#[d-f][0-9a-f]/i) // laranja: vermelho alto
      expect(t.ui.selBg).not.toBe(DEFAULT_THEME.ui.selBg)
      expect(t.terminal.selectionBackground).not.toBe(DEFAULT_THEME.terminal.selectionBackground)
    }
  })
})

describe('saveTheme', () => {
  const theme = {
    name: 'Meu',
    ui: { bg: '#101010', selBg: '#ff8800' },
    terminal: { background: '#101010' }
  }
  it('grava tema novo e lê de volta mesclado no padrão', async () => {
    const d = await tmp()
    await ensureDefaults(d)
    await saveTheme(d, 'meu', theme)
    const t = (await readTheme(d, 'meu')).theme
    expect(t.ui.selBg).toBe('#ff8800')
    expect(t.ui.fg).toBe(DEFAULT_THEME.ui.fg)
  })
  it('não sobrescreve tema padrão', async () => {
    const d = await tmp()
    await ensureDefaults(d)
    await expect(saveTheme(d, 'escuro', theme)).rejects.toThrow(/padrão/)
  })
  it('id e cores inválidos são recusados', async () => {
    const d = await tmp()
    await ensureDefaults(d)
    await expect(saveTheme(d, '../x', theme)).rejects.toThrow()
    await expect(saveTheme(d, 'ok', { ...theme, ui: { bg: 'red; }' } })).rejects.toThrow(/cor/)
  })
})
