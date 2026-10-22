/** Normaliza para busca: sem acento e sem caixa. Mesma regra da função SQL `tf_fold`. */
export function fold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}
