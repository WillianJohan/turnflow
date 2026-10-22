# Segurança

O Turnflow é um app individual e local: seus dados ficam no seu computador, sem servidor nem
telemetria. Este documento diz o que ele protege, o que não protege e o que não tem volta.

## Como reportar uma vulnerabilidade

Use o reporte privado de vulnerabilidade do GitHub (aba **Security** do repositório). Não abra
issue pública com detalhes de uma falha ainda não corrigida.

## Dados em repouso

- O banco (`turnflow.db`) é cifrado com uma chave aleatória de 256 bits (a DEK).
- A DEK fica no `key.enc`, embrulhada pelo chaveiro do sistema operacional. Quando o sistema não
  tem um chaveiro que proteja de verdade (por exemplo, o backend `basic_text` do Linux), ela é
  embrulhada por uma senha mestra que você define (Argon2id).
- Os backups (`backups/`) são cópias do banco cifradas com a mesma chave:
  - diários: as 7 últimas cópias, uma por dia em que o app abre (com uso diário, 7 dias);
  - de atualização (antes de cada migração do esquema): no máximo 3, e cada um sai depois de 7 dias;
  - cópias de resgate (`orphan-*`, um banco encontrado sem a chave ao abrir): ficam até você
    apagá-las ou usar Apagar tudo.

## A chave de recuperação

No primeiro uso o app mostra 24 palavras: elas são a DEK codificada. **As palavras são o único
caminho de volta** se a senha for esquecida, o chaveiro for perdido ou você trocar de computador
(Restaurar = arquivo de backup + as 24 palavras). Ninguém, nem o projeto, consegue recuperar seus
dados sem elas. Quem tiver as palavras e um backup consegue ler tudo: guarde-as fora deste
computador.

## O que fica fora da criptografia

- Os transcripts das sessões dos agentes de IA (Claude, Codex), que esses programas gravam por
  conta própria.
- Os worktrees e os arquivos dos projetos em que você trabalha.
- As diretrizes geradas para os agentes.
- A configuração do app (`config.json`, `ui.json`, `themes/`).
- Os logs do app (`logs/`), em texto plano: podem ter trecho de um comando SQL ou o título de uma
  task. O Apagar tudo os remove.
- O storage do renderer (`electron/`), em texto plano: o rascunho de cada task no campo de
  mensagem e o layout das abas e da lista. O Apagar tudo o limpa.
- O arquivo das 24 palavras que você salvou: fica onde você o salvou, fora da pasta de
  configuração e do alcance do Apagar tudo.

## Apagar uma task de vez

Apagar uma task definitivamente remove do banco a task, os checkpoints dela e o índice de busca,
com `secure_delete`, `wal_checkpoint(TRUNCATE)` e `VACUUM` (com os temporários em memória,
`temp_store=MEMORY`). Assim o texto não sobra em páginas livres do banco, no `-wal` nem em arquivo
temporário criado pelo app. Isso não alcança o que o sistema operacional ou o disco guardam por
conta própria (swap, snapshots do sistema de arquivos, setores remapeados de SSD).

**Limite honesto: ela continua nos backups.** Nos diários, até a rotação descartar a última cópia
que a contém (7 dias de uso); nos de atualização, até 7 dias. Numa cópia de resgate (`orphan-*`),
até você apagá-la ou usar Apagar tudo.

## Apagar tudo

"Apagar tudo" (em Ajustes, ou na tela de desbloqueio para quem esqueceu a senha e perdeu as
palavras) exige digitar `APAGAR` e faz crypto-shredding: apaga primeiro o `key.enc`, o único lugar
onde a DEK embrulhada existe, e depois o banco (com `-wal` e `-shm`), os backups, os anexos e os
logs. Por fim limpa o storage do renderer em `electron/` (rascunhos e layout) e o cache. Um marcador gravado antes do primeiro arquivo apagado faz o app terminar o trabalho na
próxima abertura se ele for interrompido. A configuração e os temas ficam.

O app não consegue apagar a chave mestra que o chaveiro do sistema guarda para ele (a "Safe
Storage" do Electron, compartilhada com o próprio Chromium, sem API para removê-la). Isso não
reabre nada: sem o `key.enc` não existe DEK embrulhada para essa chave abrir. Se quiser, remova a
entrada manualmente no gerenciador de chaves do sistema.

Uma cópia de backup que você tenha levado para fora da pasta de configuração não é alcançada pelo
Apagar tudo; ela continua legível por quem tiver as 24 palavras. O mesmo vale para o arquivo das
24 palavras que você salvou: apague-o você mesmo se quiser que ele suma.

## Fora de escopo

- Malware rodando com o mesmo usuário do sistema: ele lê o que o app lê, inclusive o banco aberto
  e o chaveiro desbloqueado.
- Quem tem acesso de root (ou administrador) na máquina.
