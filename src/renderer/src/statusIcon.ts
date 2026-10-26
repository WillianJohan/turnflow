// Valor do ícone de status no config.json:
//   "🚀"                    emoji
//   "icon:rocket"           ícone monocromático (nome do lucide); uma cor pode seguir depois de ":"
//   ""                      sem ícone
export type StatusIconValue =
  | { kind: 'none' }
  | { kind: 'emoji'; value: string }
  | { kind: 'icon'; name: string; color: string | null }

const HEX = /^#[0-9a-f]{6}$/i

export function parseIcon(v: string): StatusIconValue {
  if (!v) return { kind: 'none' }
  const m = v.match(/^icon:([a-z0-9-]+)(?::(.*))?$/)
  if (!m) return { kind: 'emoji', value: v }
  return { kind: 'icon', name: m[1], color: m[2] && HEX.test(m[2]) ? m[2] : null }
}

export function formatIcon(v: StatusIconValue): string {
  if (v.kind === 'none') return ''
  if (v.kind === 'emoji') return v.value
  return v.color ? `icon:${v.name}:${v.color}` : `icon:${v.name}`
}
