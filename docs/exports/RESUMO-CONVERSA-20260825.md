# Resumo da conversa — Galene Spartan (25/08/2026)

Use isto **primeiro** ao abrir um chat novo. O transcript completo está em `conversa-spartan-20260825.md` e no `.jsonl`.

## Onde trabalhar

O Cursor desta conversa abriu no workspace do **Castro** (`S:\workspace\smart-castro-app`, branch `bresley-update`). **Todo o Git desta conversa é no Galene**, não no Castro.

| Repo | Pasta | Remote |
|---|---|---|
| Privado (desenvolvimento) | `S:\workspace\galene-edicao-spartan` | `https://github.com/wilbresley/galene-edicao-spartan.git` |
| Público (pacote para clonar) | `S:\workspace\galene-edicao-spartan-the-gratis` | `https://github.com/wilbresley/galene-edicao-spartan-the-gratis.git` |

`move_agent_to_root` para o Galene **falha**: o Cursor tenta levar a branch `bresley-update`, que não existe no Galene. Usar `working_directory` absoluto no Galene.

## Regras que não podem cair

- PT-BR (você, tela, arquivo, celular, senha, usuário).
- **Não apagar** o que já funciona sem pedido explícito nesta mensagem: grid, lives, `resizePeers`, `showHideMedia`, `gotDownStream`, mic, bolinhas.
- **Não mexer no Nginx** (Proxy Manager) desta instalação.
- Pacote de envio ao Debian: **só** `S:\Downloads\galene-sala-static` (zerar, encher, `LEIA-ME.txt`). UI em `static/`. Só HTML/JS: `cd ~/docker/galene && cp -a galene-sala-static/static/. ./static/` (sem restart).
- Docs canônicas: `docs/01-DOCUMENTACAO-COMPLETA.md` (esta instalação) e `docs/02-DOCUMENTACAO-REPLICA-LIMPA.md` (réplica limpa).
- Histórico de chat (`docs/exports/`) **só no privado**.
- `scripts/load-image.sh` costuma aparecer modificado só por CRLF — não commitar.

## Servidor

- Pasta: `~/docker/galene` (compose `galene` + `spartan-reg`).
- Landing `/` = Cadê a Live? **nunca** o login do painel.
- Painel: `/admin/` (`static/admin/index.html`).
- Cache da sala (hoje): `galene.js?v=94`, `galene-spartan.css?v=74`. Painel: `admin.js?v=33`, `admin.css?v=22`.

## Correções desta conversa (já no código)

### Login (`galene.js?v=93` e segue)

- `gotConnected` **não** chama `setConnected(true)` até o join.
- A sala só aparece no `gotJoined` kind `join` (`setConnected(true)` + `spartanCommitSession()`).
- Senha errada: `spartanRejectJoin()`, um toast, sem graça WS 30 s / loop de toast.
- Sessão só grava **depois** do join certo.

### Grid 2 lives (`v=94`)

- 1 live = foco automático (`peer-focus-mode`).
- Bug: ao abrir a 2ª, `resizePeers` rodava **depois** do sync, via o foco, **zerava** `grid-template-columns` e saía. CSS `#peers` sem colunas = 1 coluna (uma em cima da outra). Focar/desfocar “consertava”. Com 3 lives o 2×2 já ia.
- Correção: `spartanSyncLiveFocus()` **antes** de `resizePeers()` em `spartanRefreshAllMedia`, `setMedia`, `delMedia` (e no clique de foco). Duas lives **lado a lado** na primeira abertura.

### Mic + câmera no celular (`v=94`)

- Fechar câmera fazia `c.close()` no up `camera` (áudio+vídeo juntos); o ícone do mic ficava verde mentiroso.
- Helper `spartanStopCameraKeepMic()`: se o mic está ligado, `addLocalMedia(localId, true)` (só áudio) + `setLocalMute(false)`; senão fecha e `setLocalMute(true)`.
- Usado no botão **Câmera** do header (toggle) e no **X** da própria live de câmera.

### Camlive (já estava no remoto privado)

- Quem transmite câmera avisa os outros com `camlive` no `setdata` — botão Câmera nos outros.

## O que o usuário pediu no fechamento

1. Atualizar documentação + scripts de instalação.
2. README com o que o programa é e as funções (relevante, não dump).
3. Commit detalhado.
4. Push no **privado** e no **público**.
5. Histórico da conversa **só no privado**, importável noutro chat.

## Pacote Debian (UI)

```bash
cd ~/docker/galene && cp -a galene-sala-static/static/. ./static/
```

Ctrl+Shift+R no browser.
