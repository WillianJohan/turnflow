import { readFile, rename, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { StatusRoleZ, StatusTargetZ } from '../../../shared/contracts'
import { fold } from '../../db/fold'
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
): { target: StatusTarget | null; source: StatusSource } {
  const saved = Object.hasOwn(map.entries, key) ? map.entries[key] : undefined
  if (saved) return { target: saved, source: 'saved' }
  const named = stageByName(key, stages)
  if (named) return { target: { stage: named.name }, source: 'stage_name' }
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
  const { target, source } = suggestTarget(statusKey(p.status), map, stages)
  if (!target) return none()
  let stageId: string
  if ('stage' in target) {
    const s = stageByName(target.stage, stages)
    if (!s) return none()
    stageId = s.id
  } else {
    stageId = resolveRole(target.role, stages)
  }
  const isFinal = stages.find((s) => s.id === stageId)?.is_final ?? false
  const reason =
    p.blocked ?? (!('stage' in target) && target.role === 'blocked' ? statusReason(p.status) : null)
  return {
    stage_id: stageId,
    blocked_reason: isFinal ? null : reason,
    mapped: true,
    source,
    target
  }
}

const StatusMapFileZ = z
  .object({ version: z.literal(1), entries: z.record(z.string(), StatusTargetZ) })
  .strict()

const EMPTY = (): StatusMapFile => ({ version: 1, entries: {} })

/** Ausente, ilegível ou fora do formato = mapa vazio (a semente cobre). */
export async function readStatusMap(file: string): Promise<StatusMapFile> {
  try {
    const parsed = StatusMapFileZ.safeParse(JSON.parse(await readFile(file, 'utf8')))
    return parsed.success ? parsed.data : EMPTY()
  } catch {
    return EMPTY()
  }
}

export async function writeStatusMap(file: string, m: StatusMapFile): Promise<void> {
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(m, null, 2))
  await rename(tmp, file)
}
