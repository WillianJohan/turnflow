// Só http(s) sai pro navegador: README pode ter ftp://, smb:// ou caminho relativo.
export const isExternalLink = (url: string): boolean => /^https?:\/\//i.test(url)
