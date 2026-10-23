// Texto do rascunho como bracketed paste: quebras de linha não disparam envio no claude.
// O Enter que envia vai numa escrita separada.
export function draftPayload(text: string): string | null {
  // eslint-disable-next-line no-control-regex -- remove marcadores de paste do próprio texto
  const body = text.replace(/\x1b\[20[01]~/g, '').trimEnd()
  return body.trim() ? `\x1b[200~${body}\x1b[201~` : null
}
