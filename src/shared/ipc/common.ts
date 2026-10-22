import { z } from 'zod'

// Peças reutilizadas pelos contratos. Limites só barram lixo; a regra de negócio fica no main.
export const NoInput = z.void()
export const Id = z.string().min(1).max(256)
export const Cells = z.number().int().min(1).max(10_000)
export { MAX_PTY_DATA } from './limits'
