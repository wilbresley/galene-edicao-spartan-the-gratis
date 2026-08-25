# Galene — edição Spartan

Videoconferência auto-hospedada com **[Galene](https://galene.org)** (Juliusz Chroboczek) e interface **Spartan** (HTML/CSS/JS + sidecar Python).

Repositório **privado** de [wilbresley](https://github.com/wilbresley). **Não** contém senhas de produção, `data/sidecar.auth` vivo, `registry.json` nem JSON de salas com contas reais (estão no `.gitignore`).

**Exceção:** `factory-reset/` traz a senha de fábrica conhecida `Mudar@123` (só para reset do Docker; o 1º login força troca). Hashes nesse pacote correspondem a essa senha de fábrica, não às senhas do servidor em produção.

Pacote público (mesmo código, sem dados desta instalação): [galene-edicao-spartan-the-gratis](https://github.com/wilbresley/galene-edicao-spartan-the-gratis).

## O que o programa faz

Sala de voz e vídeo **auto-hospedada**: várias pessoas no mesmo canal, com microfone, câmera e compartilhamento de tela. O Galene relê a mídia no servidor (SFU + TURN), então funciona atrás de NAT e no 4G — diferente de app P2P que trava sem TURN.

Na prática o cidadão / convidado vê:

- **Home** (`/`) — marca, “Cadê a Live?”, entrada da sala da home. Não é o login do painel.
- **Sala** (`/group/<id>/`) — nick + senha (convite) ou nick (pública). A tela da call **só** abre depois do servidor aceitar o login; senha errada fica no login, um aviso, sem loop.
- **Microfone, câmera e tela** no header. Mic sozinho = bolinha na lista, sem botão Câmera. Fechar a câmera **não** desliga o mic.
- **Lives** — 1 em foco; 2 **lado a lado**; 3–4 em grid 2×2. Clique foca; outro clique tira o foco.
- **Chat** — abre sozinho em mensagem nova (dá para desligar); textos somem depois de 24 h.
- **Lista** — bolinha cinza/amarelo/verde/vermelho; mudo e volume só no teu fone; admin pode silenciar o mic do outro ou expulsar.
- **Painel** (`/admin/`) — cadastrados, convites, salas, logs, oscilações. Só admin da sala principal. Anfitrião de sala 24 h não entra.

Cargos: **Admin**, **Verificado**, **Ouvinte**. Extra no painel: convite definitiva, convite 24 h ou pública 24 h.

## O que tem aqui

| Caminho | Função |
|---|---|
| `images/galene-local.tgz` | Imagem Docker **exata** do servidor (`galene:local`, 20/08/2026) |
| `Dockerfile` | Só se quiser recompilar (não é o caminho padrão) |
| `vendor/galene/` | Fonte do Galene pinado (commit `9e03b36`, 28/07/2026) |
| `compose.yaml` | Galene (`:8443`) + sidecar `spartan-reg` (`:8091`), `network_mode: host` |
| `registry.py` | API `/spartan-api/` (salas, convites, beacon, purge) |
| `static/` | Home, `/salas/`, `/admin/`, sala, wallpaper, CSS/JS, `sounds/*.mp3` |
| `data/*.example.json` | Modelos — copie e preencha com **as suas** contas |
| `docs/` | Documentação completa, guia limpo para replicar, backup |

## Subir

```bash
git clone git@github.com:wilbresley/galene-edicao-spartan.git
cd galene-edicao-spartan
cp .env.example .env
# edite TURN_PUBLIC_IP no .env (IP público, não o da LAN)
cp data/config.example.json data/config.json
cp data/site.example.json data/site.json
cp data/sidecar.auth.example data/sidecar.auth
chmod 600 data/sidecar.auth
cp groups/sala-principal.example.json groups/sala-principal.json
# hashes de senha: ver data/README.md
docker load -i images/galene-local.tgz
docker compose up -d
```

Não use `--build`. A imagem que sobe é a do arquivo `images/galene-local.tgz` (a mesma do teu Debian).

Proxy HTTPS (Nginx Proxy Manager, Caddy, …) na frente:

- `/` → `http://IP_LAN:8443` com **WebSocket**
- `/spartan-api/` → `http://IP_LAN:8091`

No roteador: **1194 TCP+UDP** e **50000–50100 UDP** para o servidor. Sem TURN, celular em 4G não fecha vídeo.

## Portas

| Porta | Uso |
|---|---|
| 443 | HTTPS no proxy |
| 8443 | HTTP interno do Galene (`-insecure`) |
| 8091 | Sidecar Spartan |
| 1194 TCP/UDP | TURN |
| 50000–50100 UDP | RTP |

## Documentação

- [Implantação completa (servidor atual)](docs/01-DOCUMENTACAO-COMPLETA.md) — IPs/domínio desta instalação, **sem senhas**
- [Guia para o amigo (instalar + customizar)](docs/02-DOCUMENTACAO-REPLICA-LIMPA.md) — placeholders, comandos, cores/imagens
- [Backup ZIP e imagem](docs/03-COMANDO-BACKUP.md)
- [Hashes / sidecar.auth](data/README.md)
- [Como carregar a imagem](images/README.md)

O zip de backup **privado** do Debian (`~/galene-backup-*.zip`) **não** entra neste repositório: ele tem `sidecar.auth` e hashes reais.

## Imagem Docker neste repositório

O GitHub **não** funciona como registry de `docker pull` para um `.tgz`. A imagem vai **dentro do clone**:

1. `docker load -i images/galene-local.tgz` — vira `galene:local` na máquina
2. `docker compose up -d` — o `compose.yaml` usa `image: galene:local` **sem** `build`

É a imagem salva no Debian em 20/08/2026 (~10 MB). Rebuild (`--build` / `Dockerfile`) fica só se alguém quiser recompilar de `vendor/galene`.

## Créditos

- **Galene** by [Juliusz Chroboczek](https://www.irif.fr/~jch/) — <https://galene.org>
- Interface Spartan — [wilbresley](https://github.com/wilbresley)

Terceiros em `static/third-party/` (Font Awesome, Toastify, Contextual) conservam a licença original de cada pasta.


## Instalador completo (espelho do repo público)

O pacote público tem o fluxo polido. Aqui no privado também:

```bash
chmod +x scripts/instalar-completo.sh && ./scripts/instalar-completo.sh
```

Sempre cria **sala convite**. Extra no painel: convite definitiva (padrão), convite 24h ou pública 24h (anfitrião só nas de 24h).
Guia para IA: [INSTALACAO-PARA-IA.md](INSTALACAO-PARA-IA.md).
Exports de conversa: [docs/exports/](docs/exports/) (só neste repo privado — como importar: [COMO-IMPORTAR.md](docs/exports/COMO-IMPORTAR.md)).
Regras Cursor: `.cursor/rules/` (CodeGraph + convenções Spartan).
