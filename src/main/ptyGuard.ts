// Dono de cada pty: só a webContents que o iniciou pode escrever, redimensionar ou matar.
export type PtyGuard = {
  register(id: string, ownerWebContentsId: number): void
  release(id: string): void
  canWrite(id: string, senderWebContentsId: number): boolean
}

export function createPtyGuard(): PtyGuard {
  const owners = new Map<string, number>()
  return {
    register: (id, owner) => void owners.set(id, owner),
    release: (id) => void owners.delete(id),
    canWrite: (id, sender) => owners.get(id) === sender
  }
}
