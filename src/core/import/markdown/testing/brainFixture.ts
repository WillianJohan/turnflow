// Só testes importam este arquivo. Fixtures SINTÉTICAS no formato do brain.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Escreve `files` (path relativo → conteúdo) sob `root`, criando as pastas. */
export function writeBrain(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const f = join(root, rel)
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, content)
  }
}

/** Monta um README sintético no formato do brain. */
export function readme(p: {
  key: string
  title?: string
  status?: string
  parent?: string
  checkpoints?: string[]
  sessions?: string[]
  mrs?: string[]
  body?: string
}): string {
  const out = [`# ${p.key} — ${p.title ?? 'Synthetic task'}`, '']
  if (p.status) out.push(`**Status:** ${p.status}`)
  if (p.parent) out.push(`**Pai:** ${p.parent}`)
  if (p.status || p.parent) out.push('')
  out.push('## Descrição', '', p.body ?? 'Synthetic description.', '')
  if (p.mrs) out.push('## MRs', '', ...p.mrs.map((m) => `- ${m}`), '')
  if (p.sessions) out.push('## Sessões', '', ...p.sessions.map((s) => `- ${s}`), '')
  if (p.checkpoints) out.push('## Checkpoints', '', ...p.checkpoints.map((c) => `- ${c}`), '')
  return out.join('\n')
}
