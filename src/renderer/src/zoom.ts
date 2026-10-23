// Ctrl+scroll no terminal: 1px por passo, entre 8 e 32.
export const zoomFont = (size: number, deltaY: number): number =>
  Math.min(32, Math.max(8, size - Math.sign(deltaY)))
