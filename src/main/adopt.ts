// Aba "Claude sem task" que acabou criando/assumindo uma task: o README passa a citar a
// conversa dela em ## Sessões. Essa aba é adotada pela task (mesmo processo, id novo).
export function adoptions(
  sessionOf: Map<string, string>, // id do PTY → session_id do claude (vem dos hooks)
  tasks: { id: string; sessions: { uuid: string }[] }[],
  busy: Set<string> // tasks que já têm PTY vivo no app
): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []
  for (const [pty, uuid] of sessionOf) {
    if (!pty.startsWith('~claude-')) continue
    const t = tasks.find((x) => !busy.has(x.id) && x.sessions.some((s) => s.uuid === uuid))
    if (t && !out.some((o) => o.to === t.id)) out.push({ from: pty, to: t.id })
  }
  return out
}
