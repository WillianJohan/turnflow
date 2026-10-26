import { watch } from 'fs'
import { mkdir, readdir, readFile, writeFile, access, unlink } from 'fs/promises'
import { basename, join } from 'path'
import type { AppConfig, Theme } from '../shared/types'
import { BUILTIN_THEMES, DEFAULT_THEME } from '../shared/theme/builtins'

export { BUILTIN_THEMES, DEFAULT_THEME }
import { Limits } from '../shared/contracts'
import { CONFIG_COPY } from '../shared/copy/config'
import { isAbsolutePath } from '../shared/pathSyntax'
import { IpcError } from './ipc/handle'

// Pasta de config do app (~/.config/turnflow): config.json + themes/*.json.
// Tudo editável à mão; o app nunca sobrescreve o que já existe.

export const DEFAULT_CONFIG: AppConfig = {
  theme: 'escuro',
  draftMode: false,
  notifications: true,
  fontSize: 13,
  termFont: 'JetBrains Mono',
  appFont: 'system-ui',
  appFontSize: 13,
  // um por grupo da lista (os mesmos nomes do bucketOf do tasks.ts); qualquer emoji ou caractere
  statusIcons: {
    'Merge request': '🔀',
    GMUD: '🚀',
    'Em andamento': '🔨',
    Tarefas: '📋',
    Bloqueado: '⛔',
    'Validação CS': '🎧',
    'Em teste produção': '🧪',
    Concluído: '✅',
    Arquivada: '📦',
    Outros: '❔'
  },
  // pasta de trabalho das tasks sem `workdir` próprio (absoluta); null = nenhuma
  defaultWorkdir: null,
  // pasta do brain do último import (absoluta), gravada pelo apply; null = nenhuma
  brainDir: null,
  agents: { codex: 'codex', cursor: 'cursor-agent', other: null }
}

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )
const pretty = (o: unknown): string => JSON.stringify(o, null, 2) + '\n'
const themesDir = (dir: string): string => join(dir, 'themes')

export async function ensureDefaults(dir: string): Promise<void> {
  await mkdir(themesDir(dir), { recursive: true })
  const files: [string, unknown][] = [
    [join(dir, 'config.json'), DEFAULT_CONFIG],
    ...Object.entries(BUILTIN_THEMES).map(([id, t]): [string, unknown] => [
      join(themesDir(dir), `${id}.json`),
      t
    ])
  ]
  for (const [p, v] of files) if (!(await exists(p))) await writeFile(p, pretty(v))
}

const readRaw = async (dir: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))

// Campo com tipo errado cai no padrão (theme: 5 quebrava o readTheme e o app ficava sem config).
/** Caminho absoluto dentro do teto do `Limits.workdir`, ou null. */
const absolutePath = (v: unknown): string | null =>
  typeof v === 'string' && v.length <= Limits.workdir && isAbsolutePath(v) ? v : null

const sane = (raw: Record<string, unknown>): AppConfig => ({
  theme: typeof raw.theme === 'string' ? raw.theme : DEFAULT_CONFIG.theme,
  draftMode: typeof raw.draftMode === 'boolean' ? raw.draftMode : DEFAULT_CONFIG.draftMode,
  notifications:
    typeof raw.notifications === 'boolean' ? raw.notifications : DEFAULT_CONFIG.notifications,
  fontSize: typeof raw.fontSize === 'number' ? raw.fontSize : DEFAULT_CONFIG.fontSize,
  termFont: typeof raw.termFont === 'string' ? raw.termFont : DEFAULT_CONFIG.termFont,
  appFont: typeof raw.appFont === 'string' ? raw.appFont : DEFAULT_CONFIG.appFont,
  appFontSize: typeof raw.appFontSize === 'number' ? raw.appFontSize : DEFAULT_CONFIG.appFontSize,
  statusIcons: Object.fromEntries(
    Object.entries(DEFAULT_CONFIG.statusIcons).map(([k, v]) => {
      const mine = (raw.statusIcons as Record<string, unknown> | undefined)?.[k]
      return [k, typeof mine === 'string' ? mine : v]
    })
  ),
  defaultWorkdir: absolutePath(raw.defaultWorkdir) ?? DEFAULT_CONFIG.defaultWorkdir,
  brainDir: absolutePath(raw.brainDir) ?? DEFAULT_CONFIG.brainDir,
  agents: saneAgents(raw.agents)
})

const COMMAND_MAX = 1024

const saneCommand = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.length <= COMMAND_MAX ? v : fallback

const saneAgents = (v: unknown): AppConfig['agents'] => {
  const raw = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const other = raw.other
  return {
    codex: saneCommand(raw.codex, DEFAULT_CONFIG.agents.codex),
    cursor: saneCommand(raw.cursor, DEFAULT_CONFIG.agents.cursor),
    other:
      other === null
        ? null
        : typeof other === 'string' && other.length <= COMMAND_MAX
          ? other
          : DEFAULT_CONFIG.agents.other
  }
}

// Saída do `fc-list : family` → nomes únicos ordenados (cada linha pode listar apelidos após vírgula).
export const parseFcList = (out: string): string[] =>
  [
    ...new Set(
      out
        .split('\n')
        .map((l) => l.split(',')[0].trim())
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b))

export async function readConfig(dir: string): Promise<{ config: AppConfig; error?: string }> {
  try {
    return { config: sane(await readRaw(dir)) }
  } catch (e) {
    return { config: DEFAULT_CONFIG, error: `config.json inválido: ${(e as Error).message}` }
  }
}

// Escritas em fila (tema + fonte ao mesmo tempo não perdem patch) e preservando chaves extras.
// JSON quebrado não é sobrescrito: o erro sobe e o arquivo do usuário fica como está.
let queue: Promise<unknown> = Promise.resolve()
export function writeConfig(dir: string, patch: Partial<AppConfig>): Promise<AppConfig> {
  const run = async (): Promise<AppConfig> => {
    let raw: Record<string, unknown>
    try {
      raw = await readRaw(dir)
    } catch (e) {
      throw new IpcError('VALIDATION', CONFIG_COPY.configInvalid((e as Error).message))
    }
    const next = { ...raw, ...patch }
    await writeFile(join(dir, 'config.json'), pretty(next))
    return sane(next)
  }
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p
}

// Vigia a pasta (não o arquivo): editor que salva por rename troca o inode e o watch do arquivo morria.
export function watchConfig(dir: string, onChange: () => void): () => void {
  let t: NodeJS.Timeout | undefined
  const fire = (): void => {
    clearTimeout(t)
    t = setTimeout(onChange, 150)
  }
  const ws = [
    watch(dir, (_ev, f) => f === 'config.json' && fire()),
    watch(themesDir(dir), (_ev, f) => f?.endsWith('.json') && fire())
  ]
  ws.forEach((w) => w.on('error', () => undefined))
  return () => {
    clearTimeout(t)
    ws.forEach((w) => w.close())
  }
}

/** `themes/*.json` como estão no disco (sem mesclar com o tema padrão); JSON inválido → `json: null`.
 * É o que o import compara para não duplicar: `listThemes`/`readTheme` mesclam com o escuro. */
export async function readThemesRaw(dir: string): Promise<{ id: string; json: unknown | null }[]> {
  const files = (await readdir(themesDir(dir)).catch(() => [] as string[])).filter((f) =>
    f.endsWith('.json')
  )
  return Promise.all(
    files.map(async (f) => {
      const id = basename(f, '.json')
      try {
        return { id, json: JSON.parse(await readFile(join(themesDir(dir), f), 'utf8')) as unknown }
      } catch {
        return { id, json: null }
      }
    })
  )
}

export async function listThemes(dir: string): Promise<{ id: string; name: string }[]> {
  const files = (await readdir(themesDir(dir)).catch(() => [] as string[])).filter((f) =>
    f.endsWith('.json')
  )
  return Promise.all(
    files.map(async (f) => {
      const id = basename(f, '.json')
      return { id, name: (await readTheme(dir, id)).theme.name }
    })
  )
}

// Chave faltando cai no escuro padrão; tema inválido vira o escuro com erro.
export async function readTheme(
  dir: string,
  id: string
): Promise<{ theme: Theme; error?: string }> {
  if (!/^[\w.-]+$/.test(id) || id.startsWith('.'))
    return { theme: DEFAULT_THEME, error: `tema "${id}" inválido` }
  try {
    const t = JSON.parse(await readFile(join(themesDir(dir), `${id}.json`), 'utf8'))
    return {
      theme: {
        name: t.name ?? id,
        ui: { ...DEFAULT_THEME.ui, ...t.ui },
        terminal: { ...DEFAULT_THEME.terminal, ...t.terminal }
      }
    }
  } catch (e) {
    return { theme: DEFAULT_THEME, error: `themes/${id}.json: ${(e as Error).message}` }
  }
}

export async function cloneTheme(dir: string, from: string): Promise<string> {
  if (!/^[\w.-]+$/.test(from) || from.startsWith('.'))
    throw new IpcError('VALIDATION', CONFIG_COPY.themeInvalid(from))
  const { theme } = await readTheme(dir, from)
  let id = `${from}-personalizado`
  for (let n = 2; await exists(join(themesDir(dir), `${id}.json`)); n++)
    id = `${from}-personalizado-${n}`
  await writeFile(
    join(themesDir(dir), `${id}.json`),
    pretty({ ...theme, name: `${theme.name} (personalizado)` })
  )
  return id
}

const HEX = /^#[0-9a-f]{6}$/i
const validId = (id: string): boolean => /^[\w.-]+$/.test(id) && !id.startsWith('.')

// Editor de tema: grava themes/<id>.json. Padrão é só leitura (salvar como novo).
export async function saveTheme(dir: string, id: string, theme: Theme): Promise<void> {
  if (!validId(id)) throw new IpcError('VALIDATION', CONFIG_COPY.themeNameInvalid(id))
  if (id in BUILTIN_THEMES) throw new IpcError('VALIDATION', CONFIG_COPY.themeBuiltin(id))
  for (const [k, v] of [...Object.entries(theme.ui ?? {}), ...Object.entries(theme.terminal ?? {})])
    if (!HEX.test(v)) throw new IpcError('VALIDATION', CONFIG_COPY.colorInvalid(k, v))
  await writeFile(
    join(themesDir(dir), `${id}.json`),
    pretty({ name: theme.name || id, ui: theme.ui, terminal: theme.terminal })
  )
}

export async function deleteTheme(dir: string, id: string): Promise<void> {
  if (!validId(id) || id in BUILTIN_THEMES)
    throw new IpcError('VALIDATION', CONFIG_COPY.themeNotDeletable(id))
  await unlink(join(themesDir(dir), `${id}.json`))
}
