import { BRAND } from '../brand'

// Mensagens do cofre/banco mostradas ao usuário. Sem segredo, chave ou caminho pessoal aqui.
export const VAULT_COPY = {
  migrationFailed: (version: number, name: string, detail: string): string =>
    `A atualização do banco falhou na migration ${version} (${name}): ${detail}. Seus dados não foram alterados.`,
  newerSchema: (found: number, supported: number): string =>
    `Este banco foi criado por uma versão mais nova (esquema ${found}; esta versão entende até ${supported}). Atualize o app.`,

  /** Texto de cada `VaultErrorCode`. Nunca interpolar senha, palavra ou DEK. */
  errors: {
    PASSWORD_REQUIRED: 'Defina uma senha mestra',
    PASSWORD_TOO_SHORT: 'A senha precisa de pelo menos 12 caracteres',
    WRONG_PASSWORD: 'Senha incorreta',
    WORDS_COUNT: 'A chave de recuperação tem 24 palavras',
    WORDS_UNKNOWN: 'Uma das palavras não existe na lista',
    WORDS_CHECKSUM: 'Alguma palavra está errada ou fora de ordem',
    WRONG_KEY: 'Essas palavras não abrem este banco',
    KEYRING_UNAVAILABLE:
      'Não consegui ler a chave no chaveiro do sistema. Use a chave de recuperação.',
    KEYFILE_CORRUPT: 'O arquivo da chave está corrompido. Use a chave de recuperação.',
    NOT_A_BACKUP: `Esse arquivo não é um backup do ${BRAND.name}`,
    BACKUP_NEWER: `Esse backup é de uma versão mais nova do ${BRAND.name}`,
    NEWER_SCHEMA: `Este banco foi criado por uma versão mais nova do ${BRAND.name}. Atualize o app.`,
    MIGRATION_FAILED: 'Falha na migração do banco',
    OPEN_FAILED: 'Não consegui abrir o banco',
    LOCKED: `${BRAND.name} está bloqueado`,
    BAD_STATE: 'Operação inválida neste estado'
  },
  /** `WORDS_UNKNOWN` com a posição (1-based) da primeira palavra desconhecida. */
  wordUnknown: (position: number): string => `A palavra ${position} não existe na lista`,

  recoveryTitle: `${BRAND.name} — chave de recuperação`,
  recoveryGenerated: (ymd: string): string =>
    `Gerada em ${ymd}. Guarde fora deste computador. Quem tiver estas palavras e um backup consegue ler seus dados.`
}
