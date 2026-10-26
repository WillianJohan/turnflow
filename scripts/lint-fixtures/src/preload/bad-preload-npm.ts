import { marked } from 'marked'

export const md = (s: string): string => marked.parse(s) as string
