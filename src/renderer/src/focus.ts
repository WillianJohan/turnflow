// Campo de texto de verdade (busca, rascunho). O textarea escondido do xterm não conta:
// colar nele via execCommand pularia o bracketed paste.
export const isTextField = (el: { tagName: string; className: string } | null): boolean =>
  !!el &&
  (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
  !el.className.includes('xterm-helper-textarea')
