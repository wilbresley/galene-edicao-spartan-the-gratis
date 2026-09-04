# Resumo da conversa — Galene Spartan (04/09/2026)

Use isto **primeiro** ao abrir um chat novo. Transcript: `conversa-spartan-20260904.md` (+ `.jsonl`).

## Onde trabalhar

| Repo | Pasta | Remote |
|---|---|---|
| **Privado** (dev + exports) | `S:\workspace\galene-edicao-spartan` | https://github.com/wilbresley/galene-edicao-spartan.git |
| **Público** (pacote clonável) | `S:\workspace\galene-castro` (= the-gratis) | https://github.com/wilbresley/galene-edicao-spartan-the-gratis.git |

Esta conversa (set/2026) rodou no workspace **galene-castro** (público). O privado foi alinhado ao final.

## Regras

- PT-BR (você, tela, arquivo, celular, senha, usuário).
- CodeGraph primeiro (`projectPath: s:\workspace\galene-castro` ou o path do privado).
- Não apagar grid/lives/mic sem pedido explícito.
- Não commitar `sidecar.auth`, `accounts.json`, `config.json` vivo, `registry.json` com pessoas, `groups/*.json` de produção.
- Deploy estático: `S:\Downloads\galene-sala-static` → Debian `~/docker/galene/static/` **sem** restart do Galene. `registry.py` → `docker restart spartan-reg`.
- Docs: `01` (privado com IPs da implantação) + `02` (réplica limpa). Exports **só no privado**.

## Servidor produção

- Pasta: `~/docker/galene` (containers `galene` + `spartan-reg`).
- Domínio / IPs: ver `docs/01-DOCUMENTACAO-COMPLETA.md` (seção “Onde vive”).
- Cache atual: `galene.js?v=115`, `galene-spartan.css?v=99`, `spartan-boot.js?v=9`.

## O que foi feito nesta conversa (já no código / Git)

### Presença / timers (servidor)

- Header = tempo da sala (`HH:MM:SS`); menu do nick = tempo individual.
- Sala vazia > **60 s** zera o timer da sala.
- APIs: `POST /presence`, `GET /presence-room`, `GET /presence-user`.
- Constantes: `PRESENCE_STALE_S=45`, grace usuário/sala **60 s**.
- Reiniciar `spartan-reg` após mudar `registry.py`.

### Reconexão (60 s)

- Oscilação &lt; 60 s: silent reconnect; preserva mic/tela/câmera; sem overlay.
- ≥ 60 s: fecha mídia + overlay; ao voltar precisa religar.
- Flag `_spartanRecoveringMedia`; recover **não** força `setLocalMute(true)`.
- Snapshot `hadCamera` / `hadMicOnly` (não promove mic-só a câmera).

### Botões live

- **Câmera** só com `streamHasRealVideo`; **Tela** só `screenshare`.
- Mic sozinho = bolinha (sem botão sob o nick). Removido atalho `camlive` para inventar Câmera.

### FPS / bitrate da tela

- Captura: `frameRate` ideal/max **60** (**sem `min`** — Chrome rejeita no `getDisplayMedia`).
- Encoder: `maxFramerate: 60`, `maintain-framerate`.
- Tetos: auto **12 Mbps**, 1080p **10**, 720p **5** (independente do “Enviar” da câmera).
- Bypass **REMB** (~200 kbps): remove `goog-remb` do offer da screenshare.
- HUD: `alvo 60 · N fps · kbps/teto`. Oscilar em torno do teto (pico curto acima) é normal.
- 12 Mbps basta para 1080p60 em jogos frenéticos; use 720p em upload lento / distância.

### Contador amarelo (pendência UX)

- CSS força branco + `?v=99` (commit `be2a8b9`). No server o arquivo bate md5, mas o browser ainda pode mostrar amarelo (cache). Deixado de lado por hora; resto ok.

### Commits públicos relevantes

- `9258ef8` presença + reconexão 60s + shell
- `c11d228` botões Câmera/mic-só + recover
- `3e50d70` FPS/bitrate/REMB
- `be2a8b9` contador branco CSS `v=99`

## Como a outra IA deve continuar

1. Ler este resumo + anexar `conversa-spartan-20260904.md` se precisar de detalhe.
2. Trabalhar no repo certo (privado para exports/IPs; público para pacote limpo).
3. Não recriar usuários do Debian; deploy só `static/` + `registry.py`.
4. Se for mexer no contador amarelo: inspecionar CSS computado no browser (`galene-spartan.css?v=99`) e herança de `.navbar { color: #dc2626 }` vs `#spartan-live-clock`.
