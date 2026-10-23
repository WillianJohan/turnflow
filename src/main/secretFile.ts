import { open } from 'node:fs/promises'

/**
 * Grava texto sensível só para o dono. O chmod vem antes da escrita: um arquivo que já existia
 * com 0644 nunca chega a ter o conteúdo enquanto ainda legível por outros.
 */
export async function writeSecretFile(path: string, text: string): Promise<void> {
  const fh = await open(path, 'w', 0o600)
  try {
    await fh.chmod(0o600)
    await fh.writeFile(text)
  } finally {
    await fh.close()
  }
}
