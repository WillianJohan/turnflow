// Mensagens do cofre/banco mostradas ao usuário. Sem segredo, chave ou caminho pessoal aqui.
export const VAULT_COPY = {
  migrationFailed: (version: number, name: string, detail: string): string =>
    `A atualização do banco falhou na migration ${version} (${name}): ${detail}. Seus dados não foram alterados.`,
  newerSchema: (found: number, supported: number): string =>
    `Este banco foi criado por uma versão mais nova (esquema ${found}; esta versão entende até ${supported}). Atualize o app.`
}
