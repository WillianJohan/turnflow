// Mensagens de config, temas e ambiente mostradas ao usuário (erros que viram IpcError).
export const CONFIG_COPY = {
  claudeNotFound: 'claude não encontrado no PATH do shell',
  configInvalid: (detail: string): string => `config.json inválido, corrija antes: ${detail}`,
  themeInvalid: (from: string): string => `tema "${from}" inválido`,
  themeNameInvalid: (id: string): string => `nome de tema inválido: "${id}"`,
  themeBuiltin: (id: string): string => `"${id}" é tema padrão — salve como tema novo`,
  colorInvalid: (key: string, value: string): string => `cor inválida em ${key}: ${value}`,
  themeNotDeletable: (id: string): string => `"${id}" não pode ser excluído`
}
