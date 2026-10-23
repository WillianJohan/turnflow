import { readFileSync } from 'fs'

export const ler = (p: string): string => readFileSync(p, 'utf8')
