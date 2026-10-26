// E6.8 deriva os tokens e o tema do terminal a partir de scheme, fundo, cor principal e cor da IA.
// Hex de cor do produto só pode nascer neste arquivo e em builtins.ts.
export type DeriveInput = {
  scheme: 'dark' | 'light'
  bg: string
  accent: string
  ai: string
}
