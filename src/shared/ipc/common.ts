import { z } from 'zod'

// Peças reutilizadas pelos contratos. Limites só barram lixo; a regra de negócio fica no main.
export const NoInput = z.void()
export const Id = z.string().min(1).max(256)
export const Cells = z.number().int().min(1).max(10_000)
export const MAX_PTY_DATA = 1024 * 1024 // 1 MB por mensagem pro pty
