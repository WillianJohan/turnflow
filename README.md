# Turnflow

Lista as tasks do brain (`~/Documents/Digitalk/brain/tasks/{current,done}`) e abre cada uma numa aba com o `claude` daquela task rodando num terminal de verdade. Painéis lado a lado, bolinha de estado e um resumo "o que é / parei em / próximo" no topo.


## Instalar

```bash
npm install                 # compila o node-pty pro Electron (não precisou de toolbox no Fedora Atomic)
npm run build               # o atalho roda o build em out/ — refazer depois de mudar o código
npm run start               # ou abre "Turnflow" pelo menu do sistema

O atalho chama o binário do Electron direto (sem npm/asdf). O PATH do claude vem de um `bash -ic` limpo, porque o brew (onde está o asdf) só entra no shell interativo.
```

`npm run dev` sobe com hot reload. `npm test` roda os testes.

## Atalhos

Todo atalho do app é **Ctrl+Shift**. O resto do teclado é do terminal (Ctrl+K, Ctrl+W, Ctrl+R… continuam do bash/claude).

| Atalho | Ação |
|---|---|
| Ctrl+Shift+K | buscar task |
| Ctrl+Shift+T | nova aba: Claude sem task, terminal ou escolher task (também no **+** da barra de abas). Se o Claude sem task criar ou assumir uma task, a aba vira a dessa task na hora |
| Ctrl+Shift+\\ | novo painel à direita (abre a busca) |
| Ctrl+Shift+W | fecha a aba (a sessão continua em "Abertas") |
| Ctrl+Shift+1..9 | aba N do painel |
| Ctrl+Shift+PageUp/PageDown | aba anterior/próxima |
| Ctrl+Shift+←/→ | painel à esquerda/direita |
| Ctrl+Shift+B | mostra/esconde a lista lateral (recolhida vira uma faixa de ícones); ao mostrar, o foco vai pra lista |
| Ctrl+Shift+U | Atualizar: roda `/revisao-demandas` num popup |
| Ctrl+Shift+D | draft mode: caixa de rascunho (Enter quebra linha, Ctrl+Enter envia) |
| Ctrl+C / Ctrl+V | copia (com seleção; sem seleção interrompe o claude) / cola (imagem passa pro claude) |
| Shift+Enter | quebra linha no prompt do claude |
| Ctrl+scroll | zoom da fonte só naquela aba (fica salvo por task; a base é a fonte das Configurações) |
| Ctrl+Shift+C / V | copiar / colar no terminal |

Um clique na lista abre a task numa aba prévia (título em itálico) que o próximo clique reaproveita; clique duplo (na lista ou na aba), Retomar/Nova sessão ou arrastar fixam a aba. Clique do meio fecha aba. Arrastar aba: soltar no meio de um painel move pra ele; soltar na borda esquerda/direita abre um painel novo daquele lado. O título da janela mostra a aba ativa de cada painel. A divisória entre painéis arrasta pra redimensionar (clique duplo iguala); a borda direita da lista lateral também arrasta.

## Config e temas

Tudo em `~/.config/turnflow/` (botão ⚙ → "Abrir pasta de config"). Dados internos do Electron (cache, layout, resumos, hooks.json) ficam em `~/.config/turnflow/electron/`:

- `config.json` — `theme` (nome do arquivo em `themes/`), `draftMode`, `fontSize`/`termFont` (terminal), `appFont`/`appFontSize` (interface), `statusIcons` (ícone de cada grupo: emoji como `"🚀"` ou ícone monocromático como `"icon:rocket:#2e7cd1"`; o seletor fica em ⚙ → Ícones dos status). Fontes listadas pelo fontconfig (`fc-list`).
- Temas padrão em `themes/`: `escuro`, `claro`, `darkest` (preto, estilo GitHub Dark), `orange-dark`, `orange-light`, `dracula`, `nord`, `tokyo-night`, `catppuccin-mocha`, `gruvbox`, `one-dark` e `rose-pine-dawn`. Recriados se apagados; o editor não sobrescreve (salva como tema novo).
- ⚙ abre a aba **Configurações**: escolher tema, editar cada cor com pré-visualização ao vivo (inclusive a cor de seleção), salvar/excluir tema próprio, fontes, draft mode e ícones dos status. Chave que faltar no JSON cai no escuro padrão.
- Salvou o arquivo, o app aplica na hora (inclusive editor que salva por rename, como vim). Se o `config.json` ficar com JSON inválido, o app usa os padrões e **não** sobrescreve o arquivo até você corrigir. `ui` são as cores da interface; `terminal` é o tema do xterm (aceita as 16 cores ANSI). As cores do próprio Claude seguem o `/theme` dele.

## Notificações

Quando um Claude pede permissão ou termina o turno e você não está vendo aquela aba (janela sem foco ou aba escondida), sai um aviso do sistema. Clicar traz o Turnflow pra frente na aba. No máximo um aviso a cada 15s por task; liga/desliga em ⚙ → Configurações (`notifications` no config.json).

## Bolinha

🟡 Claude esperando você · 🟢 trabalhando · ⚪ parado. Vem dos hooks do Claude Code, ligados só nas sessões abertas pelo app (`--settings ~/.config/turnflow/hooks.json`); o `~/.claude/settings.json` não é tocado.

## O que ele não faz

- Não escreve no brain nem fala com o Jira. Status desatualizado → botão ⟳ / Ctrl+Shift+U.
- Não cria task (continua no `wf`).
- Não abre sessão que já está aberta fora dele (dkm, outra aba): avisa e oferece sessão nova.
- Abrir uma task mostra o README formatado, com o resumo e os botões **Retomar sessão** / **Nova sessão** em cima; o Claude só sobe no clique. Com sessão aberta, o botão README/Terminal alterna as duas vistas.
- Ao fechar o app, todas as sessões são encerradas (a conversa fica salva). Ao reabrir, volta o layout mostrando os READMEs.

## Dev

- `TURNFLOW_BRAIN=<dir>` usa um brain de teste.
- `TURNFLOW_SHOT=<png> [TURNFLOW_SHOT_MS] [TURNFLOW_SHOT_JS=<js>] npm run start` tira um print e fecha.
- `TURNFLOW_DEBUG=<arquivo>` grava a saída crua dos PTYs e o console do renderer.
