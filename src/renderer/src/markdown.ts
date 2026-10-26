import DOMPurify from 'dompurify'
import { marked } from 'marked'

// README do brain → HTML sanitizado. Link http(s) abre no navegador (o main manda pro shell).
export function renderMd(text: string): string {
  const html = DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true }) as string)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noreferrer')
  })
  return doc.body.innerHTML
}
