// xterm de processo morto e sem aba aberta pode ir embora; ids "__x__" são de modais e têm dono próprio.
export const termsToDispose = (exited: Record<string, number>, openIds: Set<string>): string[] =>
  Object.keys(exited).filter((id) => !openIds.has(id) && !id.startsWith('__'))
