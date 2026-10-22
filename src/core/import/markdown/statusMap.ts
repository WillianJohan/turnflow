import { randomBytes } from 'node:crypto'
import { access, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { StatusRoleZ, StatusTargetZ } from '../../../shared/contracts'
import { fold } from '../../db/fold'
import { importError } from '../errors'
import type { BrainDir } from './scan'

export type StatusRole = z.infer<typeof StatusRoleZ>
export type StatusTarget = z.infer<typeof StatusTargetZ>
export type StatusMapFile = { version: 1; entries: Record<string, StatusTarget> }
/** Só etapas vivas, em ordem. */
export type FlowStageLite = {
  id: string
  name: string
  short_name: string
  position: number
  waits_other: boolean
  is_final: boolean
}
export type StatusSource = 'saved' | 'stage_name' | 'seed' | 'none'
export type Resolved = {
  stage_id: string
  blocked_reason: string | null
  mapped: boolean
  source: StatusSource
  target: StatusTarget | null
}

/** Chave do mapa: a parte antes do `:`, sem espaço nas pontas, sem acento nem caixa. */
export function statusKey(status: string): string {
  const i = status.indexOf(':')
  return fold((i < 0 ? status : status.slice(0, i)).trim())
}

/** O que vem depois do `:` (ex.: "Bloqueada: aguardando X"), ou null se não há. */
export function statusReason(status: string): string | null {
  const i = status.indexOf(':')
  if (i < 0) return null
  return status.slice(i + 1).trim() || null
}

/** Semente genérica (en/pt/es), testada contra a chave já `fold`ada. A ordem decide o empate. */
export const SEED_RULES: { re: RegExp; role: StatusRole }[] = [
  {
    re: /^(done|closed|complete|completed|finished|delivered|conclu|entregue|finaliz|feito|hecho|terminad)/,
    role: 'final'
  },
  { re: /^(blocked|bloquead|bloqueo)/, role: 'blocked' },
  {
    re: /^(review|in review|code review|revis|merge request|pull request|testing|em teste|en prueba|qa)/,
    role: 'review'
  },
  {
    re: /^(in progress|doing|em andamento|fazendo|desenvolv|implement|en progreso|en curso)/,
    role: 'working'
  },
  { re: /^(to do|todo|backlog|refin|a fazer|por hacer|open|new|novo)/, role: 'first' }
]

const ordered = (stages: FlowStageLite[]): FlowStageLite[] =>
  [...stages].sort((a, b) => a.position - b.position)

/** Id da etapa que cumpre o papel neste fluxo (`blocked` = a primeira; o motivo é de quem chama). */
export function resolveRole(role: StatusRole, stages: FlowStageLite[]): string {
  const all = ordered(stages)
  if (all.length === 0) throw importError('VALIDATION', 'flow_has_no_stages')
  const live = all.filter((s) => !s.is_final)
  const first = all[0].id
  const working = (): string => live.filter((s) => !s.waits_other)[1]?.id ?? first
  switch (role) {
    case 'first':
    case 'blocked':
      return first
    case 'final':
      return (all.find((s) => s.is_final) ?? all[all.length - 1]).id
    case 'review':
      return live.find((s) => s.waits_other)?.id ?? working()
    case 'working':
      return working()
  }
}

function stageByName(name: string, stages: FlowStageLite[]): FlowStageLite | undefined {
  const k = fold(name)
  return ordered(stages).find((s) => fold(s.name) === k || fold(s.short_name) === k)
}

/** Sugestão para uma chave: o salvo vence o nome de etapa, que vence a semente. */
export function suggestTarget(
  key: string,
  map: StatusMapFile,
  stages: FlowStageLite[]
): { target: StatusTarget | null; source: StatusSource; stage_id?: string } {
  if (!key) return { target: null, source: 'none' }
  const saved = Object.hasOwn(map.entries, key) ? map.entries[key] : undefined
  if (saved) return { target: saved, source: 'saved' }
  const named = stageByName(key, stages)
  if (named) return { target: { stage: named.name }, source: 'stage_name', stage_id: named.id }
  const seed = SEED_RULES.find((r) => r.re.test(key))
  if (seed) return { target: { role: seed.role }, source: 'seed' }
  return { target: null, source: 'none' }
}

export function resolveStatus(
  p: { status: string | null; dir: BrainDir; blocked: string | null },
  map: StatusMapFile,
  stages: FlowStageLite[]
): Resolved {
  if (p.dir === 'done') {
    return {
      stage_id: resolveRole('final', stages),
      blocked_reason: null,
      mapped: true,
      source: 'seed',
      target: { role: 'final' }
    }
  }
  const none = (): Resolved => ({
    stage_id: resolveRole('first', stages),
    blocked_reason: p.blocked,
    mapped: false,
    source: 'none',
    target: null
  })
  if (p.status === null) return none()
  const { target, source, stage_id } = suggestTarget(statusKey(p.status), map, stages)
  if (!target) return none()
  let stageId: string
  if (stage_id) {
    stageId = stage_id
  } else if ('stage' in target) {
    const s = stageByName(target.stage, stages)
    // Salvo aponta para etapa que não existe mais: a UI explica; o status cai na primeira etapa.
    if (!s) return { ...none(), source, target }
    stageId = s.id
  } else {
    stageId = resolveRole(target.role, stages)
  }
  const isFinal = stages.find((s) => s.id === stageId)?.is_final ?? false
  const reason =
    p.blocked ??
    (!('stage' in target) && target.role === 'blocked'
      ? (statusReason(p.status) ?? p.status.trim())
      : null)
  return {
    stage_id: stageId,
    blocked_reason: isFinal ? null : reason,
    mapped: true,
    source,
    target
  }
}

export type StatusMapProblem = 'unreadable' | 'invalid' | 'newer_version'
export type StatusMapRead = { map: StatusMapFile; problem?: StatusMapProblem; dropped: number }

/** Normaliza as chaves com `statusKey` e descarta (contando) as entradas inválidas. */
export function normalizeEntries(raw: Record<string, unknown>): {
  entries: Record<string, StatusTarget>
  dropped: number
} {
  const entries: Record<string, StatusTarget> = {}
  let dropped = 0
  for (const [k, v] of Object.entries(raw)) {
    const key = statusKey(k)
    const t = StatusTargetZ.safeParse(v)
    if (!key || !t.success) dropped++
    else entries[key] = t.data
  }
  return { entries, dropped }
}

const EMPTY = (): StatusMapFile => ({ version: 1, entries: {} })
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Ausente = mapa vazio sem problema; o resto vem com `problem` e a semente cobre. */
export async function readStatusMap(file: string): Promise<StatusMapRead> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { map: EMPTY(), dropped: 0 }
    return { map: EMPTY(), problem: 'unreadable', dropped: 0 }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { map: EMPTY(), problem: 'unreadable', dropped: 0 }
  }
  if (!isRecord(json) || typeof json.version !== 'number' || !isRecord(json.entries))
    return { map: EMPTY(), problem: 'invalid', dropped: 0 }
  if (json.version > 1) return { map: EMPTY(), problem: 'newer_version', dropped: 0 }
  if (json.version !== 1) return { map: EMPTY(), problem: 'invalid', dropped: 0 }
  const { entries, dropped } = normalizeEntries(json.entries)
  return { map: { version: 1, entries }, dropped }
}

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )

/**
 * Grava o mapa. Arquivo existente ilegível, inválido ou com entradas descartadas vai para `.bak`
 * antes (nada do usuário se perde calado); de versão mais nova, recusa.
 */
export async function writeStatusMap(file: string, m: StatusMapFile): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const cur = await readStatusMap(file)
  if (cur.problem === 'newer_version') throw importError('CONFLICT', 'status_map_newer_version')
  if ((cur.problem || cur.dropped > 0) && (await lstat(file)).isFile()) {
    let bak = `${file}.bak`
    if (await exists(bak)) bak = `${file}.bak.${randomBytes(4).toString('hex')}`
    await rename(file, bak)
  }
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(m, null, 2))
    await rename(tmp, file)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}
