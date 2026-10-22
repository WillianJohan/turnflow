import { BRAND } from '../../../../shared/brand'
import { VAULT_COPY } from '../../../../shared/copy/vault'

// Textos das telas de segurança (primeiro uso, chave de recuperação, desbloqueio, falha).
export const COPY = {
  loading: `Abrindo o ${BRAND.name}…`,

  passwordTitle: 'Senha mestra',
  passwordIntro: `Este computador não tem um chaveiro do sistema que proteja a chave. A senha mestra protege os dados do ${BRAND.name}.`,
  passwordWarning: 'Sem a senha e sem a chave de recuperação, não há como recuperar seus dados.',
  passwordNew: 'Senha',
  passwordConfirm: 'Repita a senha',
  passwordSubmit: 'Continuar',
  passwordShort: VAULT_COPY.errors.PASSWORD_TOO_SHORT,
  passwordMismatch: 'As senhas não são iguais',

  wordsTitle: 'Chave de recuperação',
  wordsIntro:
    'Anote estas 24 palavras, na ordem, e guarde fora deste computador. Elas abrem seus dados se a senha ou o chaveiro falharem.',
  wordsLoading: 'Gerando a chave…',
  copy: 'Copiar',
  copied: 'Copiado',
  saveFile: 'Salvar arquivo',
  savedTo: (path: string): string => `Salvo em ${path}`,
  savedCheck: 'Salvei em lugar seguro',
  continue: 'Continuar',

  unlockTitle: `Desbloquear o ${BRAND.name}`,
  unlockPassword: 'Senha mestra',
  unlockSubmit: 'Desbloquear',
  wrongPassword: 'Senha incorreta',
  recoverLink: 'Usar chave de recuperação',

  recoverTitle: 'Usar chave de recuperação',
  /** Por que o banco está bloqueado: o mesmo texto do vault. */
  lockReason: VAULT_COPY.lockReason,
  recoverWords: 'As 24 palavras, separadas por espaço',
  recoverNew: 'Senha nova',
  recoverConfirm: 'Repita a senha nova',
  recoverOptional: 'Deixe a senha em branco para guardar a chave no chaveiro do sistema.',
  recoverSubmit: 'Desbloquear',
  recoverBack: 'Voltar para a senha',

  failedTitle: 'O banco não pôde ser aberto',
  retry: 'Tentar de novo'
}
