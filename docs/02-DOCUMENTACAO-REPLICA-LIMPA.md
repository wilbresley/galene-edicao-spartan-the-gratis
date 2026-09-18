# Galene + interface Spartan — guia para replicar (limpo)

Este texto **não contém** domínio, IP, senha nem nick da implantação original. Serve para instalar **do zero** no teu servidor, com as **tuas** contas, cores e imagens.

Software de base: **[Galene](https://galene.org)** (Juliusz Chroboczek). “Spartan” é a casca: HTML/CSS/JS + sidecar Python.

Há **dois caminhos**:

| | Quando usar |
|---|---|
| **A — pacote pronto** | Alguém te passou o repo (ou um zip limpo). Mais rápido. |
| **B — do zero** | Você quer repetir o raciocínio da implantação original, comando a comando. |

Os dois terminam no mesmo tipo de stack. Sempre **as tuas** senhas e o **teu** domínio.

---

## 0. O que este stack faz (modificações em cima do Galene)

O Galene oficial sobe uma videoconferência SFU + TURN. Por cima foi feita uma interface e um serviço extra:

1. **Home** com wallpaper e marca — **shell SPA** na raiz `/`: nick + senha da conta; **Convidado?** (`#/convidado`) ou o link `#/i/<código>` cria conta já no servidor. Hash `#/s/<servidor>/<canal>`. Login da sala (iframe Galene) fica de reserva se a sessão cair.
2. **`/#/salas`** some da cara: quem tem o servidor vê os canais **dentro** dele.
3. **`/admin/`** — painel (`static/admin/index.html`). Na casca, o botão do painel aparece para `can-panel` `scope=admin` (**Painel Admin**) ou `scope=mod` (**Painel (moderador)**, só os servidores dele). A raiz `/` é a landing, **nunca** o login do admin sozinho.
4. **Sala** `/group/<id>/` — login no estilo da home; lives sob demanda (botão **Tela**/**Câmera** no nick). **Modo jogo**, preset **720p** (upload lento), **60 fps** na captura, HUD **só na live que você envia**. Codec preferido **VP8** antes de VP9 na sala principal. JS Spartan extra: `spartan-quality.js`, `spartan-net.js`, `spartan-watch.js`. No shell (`?shell=1`) a sala preenche o iframe; **Sair** volta à home do app.
5. **Sidecar** `registry.py` na porta **8091**, no proxy em `/spartan-api/`.
6. Salas **públicas** (só nick, ou conta cadastrada) **sempre 24h** vs **convite extra** (definitiva **ou** 24h). A **principal** não expira.
7. Sala **principal** (`site.json` → `main`) não apaga pelo painel; **home** pode apontar para outra (não para sala de 24h).
8. Só as extra **com ttl** somem sozinhas (~20 s). Contador à direita do nome, persiste no F5. `BAN_IP = False` no Python.
9. Senhas no disco **hasheadas**. `sidecar.auth` é o único segredo em claro (chmod 600).
10. Rodapé: crédito **obrigatório** do Galene/Juliusz; o do meio podes trocar pelo teu nome.

Isto **não** é o MiroTalk. MiroTalk P2P trava em NAT/4G sem TURN. Galene relê a mídia.

Cache da sala (hoje): `galene.js?v=136`, `spartan-quality.js?v=1`, `spartan-net.js?v=1`, `spartan-watch.js?v=1`, `settings.js?v=2`, `galene-spartan.css?v=104`, `protocol.js?v=9`, `spartan-boot.js?v=11`. Shell: `spartan-shell.js?v=9`, `spartan-shell.css?v=32`, `spartan-servers.js?v=24`, `custom-home.js?v=10`. Trocar de canal de voz com tela/câmera ou live assistida abre um cartão no meio da tela; só mic troca na hora. Clicar noutro **servidor** não sai da call (mic/lives/tela seguem); só entra na voz nova se clicar num canal de voz. Engrenagem sempre abre a telinha minimalista do shell (trocar senha; **Painel Admin** / **Painel (moderador)** conforme o cargo; qualidade da tela e sons); nunca o painel antigo da sala no iframe. Sair pergunta num cartão flutuante (sem aviso nativo do navegador). Lista de membros: bola + nome na mesma linha. Canais de voz/texto têm ID preso ao servidor (`servidor__canal`); a Voz 1 de um servidor não é a do outro. A lista de canais **não** tem atalho de criar sala — isso fica no cartão do servidor no Painel (lista, cria, renomeia, reordena e apaga; Chat Geral / Voz 1 / Ausentes não apagam). Painel: `admin.js?v=52`, `admin.css?v=37`. Botão **Câmera**/**Tela** sob o nick só com vídeo/tela reais (mic = bolinha). Live de tela só executa no clique; fechar (X ou de novo Tela/Câmera) para de assistir só no teu cliente. A *sua* live começa visível; clicar no quadrado embaixo do teu nick só oculta no teu grid. Tela sem assistir **não baixa mídia** (catálogo `spartanLivesV1` + `requestStreamById` no clique; sem `video-low`); som da screenshare começa mudo (F5/foco não religam; desconexão reconstitui o volume que o usuário tinha ligado). **Reconexão:** snapshot antes do close; &lt; 60 s preserva mic/tela; ≥ 60 s fecha mídia + overlay. **Tela:** FPS-alvo 60; teto auto **12 Mbps** / 1080p **10** / 720p **5** com escada se o upload apertar; bypass REMB; HUD **só na tua live** (`enviando · alvo · fps · kbps`). Mic com supressão: `voiceIsolation`. Contador da sala no header **branco** (começa com gente na call; 5 min vazia zera). Quem assiste clica em **Tela** no nick. Salas 24h: só link direto; admin vê em **temporárias** (não lista canal de voz de servidor). `/painel/` redireciona para `/admin/`. Reiniciar `docker restart spartan-reg` após mudar `registry.py`. No lab WSL, `scripts/reset-lab.ps1` zera dados e reaplica `factory-reset/` (não reaproveita `data/`/`groups/` do clone).

**Reformulação 09/09/2026:** HUD só no envio; teto adaptativo; ICE sem loopback fora do lab; sidecar atômico com senha no beacon/presence; senha admin só na sessão. O plano da secção 10 está **no pacote**.

**Servidores (17/09/2026):** casca em 4 colunas. Ícones de servidor; canal de texto padrão **Chat Geral** (extra pelo admin) e voz; coluna inteira do grid; membros ocultos, cada um numa caixinha. Login abre o **Chat Geral**. Clicar no texto abre janela **por cima do grid**. Chat aceita colar print e arquivo (imagem, mp4, mp3, até 100 MB). Chrome velho da call some no iframe. Gente no canal de voz: avatar + bolinha de mic + Tela/Câmera (visíveis se houver live, inclusive a do outro); volume só ao clicar (0–400%, passo 5%, %, rodinha); Mudo cinza / amarelo / vermelho / os dois; sem arrastar usuário na lista (mover só no Painel Admin). Chat overlay abre na mensagem mais nova. Aba Salas do painel não lista canal de voz de servidor. Duas lives próprias abrem **lado a lado** (Tela 1 / Tela 2). Clicar no quadrado da sua live só oculta no teu grid; no amigo, para de baixar. Uma call Galene por vez. Clicar noutro servidor **não** sai da call; só troca a voz se você clicar num canal de voz daquele servidor. Hash `#/s/<servidor>/<canal>`. Barra: nick, canal, mic, compartilhar tela, câmera, engrenagem, Sair. **Acesso:** admin global vê tudo; verificado só os servidores da lista/convite (Spartan oficial também). Moderador no painel só a aba Servidores dos que tem. Convite é **link eterno** (`#/i/<código>`); **Trocar link** invalida o antigo. Tirar da lista expulsa da call.

---

## 1. O que precisas

- Debian (ou similar) com **Docker** + **Compose**
- Proxy HTTPS (Nginx Proxy Manager, Caddy, Traefik…) com **WebSocket**
- IP **público** e portas de TURN no roteador
- Domínio com certificado (Let’s Encrypt / Cloudflare)

Sem TURN acessível da internet, celular em 4G **não** fecha vídeo.

---

## 2. Portas

| Porta | Protocolo | Uso |
|---|---|---|
| **443** | TCP | HTTPS no proxy (único que o usuário vê) |
| **8443** | TCP | HTTP interno do Galene (`-insecure`) |
| **8091** | TCP | Sidecar `/spartan-api/` |
| **1194** | TCP **e** UDP | TURN nativo |
| **50000–50100** | UDP | RTP |

No roteador: **1194 TCP+UDP** e **50000–50100 UDP** → IP LAN do servidor.

---

## 3. Arquitetura

```
Cliente  --HTTPS 443-->  Proxy (SEU_DOMINIO)
                           ├── /              → IP_LAN:8443   Galene (WebSocket)
                           └── /spartan-api/  → IP_LAN:8091   sidecar
```

Containers com **`network_mode: host`**. Sem isto o TURN anuncia o IP errado e o vídeo trava.

Galene: `-http :8443 -insecure`. TLS só no proxy.  
`canonicalHost` / `proxyURL`: `https://SEU_DOMINIO/`

---

## 4. Caminho A — pacote pronto (recomendado)

### 4.1 Copiar o projeto para o servidor

Se tem o Git (repo privado, convite, ou zip **sem** `sidecar.auth` / `registry.json` / salas reais):

```bash
cd ~/docker
git clone URL_DO_REPO galene
cd galene
```

Ou descompacta o zip limpo em `~/docker/galene`.

### 4.2 Ficheiros teus (não copies senhas de ninguém)

```bash
cd ~/docker/galene
cp .env.example .env
nano .env
# TURN_PUBLIC_IP= o IP público (curl -4 ifconfig.me) — NÃO o da LAN

cp data/config.example.json data/config.json
cp data/site.example.json data/site.json
cp data/sidecar.auth.example data/sidecar.auth
chmod 600 data/sidecar.auth
cp groups/sala-principal.example.json groups/sala-principal.json
```

Edita:

- `data/config.json` — `proxyURL`, `canonicalHost`, nick do **OPERADOR**
- `groups/sala-principal.json` — mesmo nick, `displayName`
- `data/site.json` — `"main"` e `"home"` = slug do arquivo (ex.: `sala-principal`)
- `data/sidecar.auth` — uma linha `nick:senha` **em claro**, a **mesma** conta admin do `config.json`

### 4.3 Hash da senha do admin (sem galenectl na imagem)

A imagem Docker só traz o binário `galene`, não o `galenectl`. Gera o objeto hash assim:

```bash
python3 - << 'PY'
import os, hashlib, json
pw = input("Senha do operador: ").strip()
salt = os.urandom(8)
key = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 4096, dklen=32)
print(json.dumps({
  "type": "pbkdf2",
  "hash": "sha-256",
  "key": key.hex(),
  "salt": salt.hex(),
  "iterations": 4096
}, indent=2))
PY
```

Cola o JSON no campo `password` de `data/config.json` **e** de `groups/sala-principal.json` (conta `op`). **Não** uses `"type": "wildcard"` na senha do admin.

Sala **pública** (só nick): deixa o wildcard-user com `"password": {"type": "wildcard"}`.  
Sala **convite**: wildcard-user com o **mesmo tipo de objeto hash** (senha dos amigos).

Não apagues o campo `password` do wildcard: o Galene recusa a entrada.

### 4.4 Firewall

```bash
sudo ufw allow 1194/tcp comment 'galene-turn'
sudo ufw allow 1194/udp comment 'galene-turn'
sudo ufw allow 50000:50100/udp comment 'galene-rtp'
# 8443 e 8091 só LAN, se o proxy estiver na mesma máquina:
sudo ufw allow from 192.168.0.0/16 to any port 8443 proto tcp
sudo ufw allow from 192.168.0.0/16 to any port 8091 proto tcp
```

Ajusta a rede LAN à tua (`192.168.100.0/24`, etc.).

### 4.5 Carregar a imagem e subir

```bash
cd ~/docker/galene
docker load -i images/galene-local.tgz
docker compose up -d
docker compose ps
docker logs galene --tail 30
docker logs spartan-reg --tail 20
curl -sS http://127.0.0.1:8443 | head
curl -sS http://127.0.0.1:8091/spartan-api/health; echo
```

**Não** uses `docker compose up --build`. Isso recompila e deixa de ser a imagem congelada.

No log do Galene tem de aparecer o TURN no **IP público**. `Relay test failed` no primeiro boot = porta 1194 ainda não chegou da WAN.

### 4.6 Proxy (Nginx Proxy Manager)

1. Host: `SEU_DOMINIO` → `http://IP_LAN:8443`, **Websockets ligado**, SSL.
2. Custom Location: `/spartan-api/` → `http://IP_LAN:8091` (barra final importa).

### 4.7 Abrir no browser

| URL | Tela |
|---|---|
| `https://SEU_DOMINIO/` | Home |
| `/salas/` | Outras salas |
| `/admin/` | Painel (`static/admin/index.html`) |
| `/group/sala-principal/` | Sala (ajusta o slug) |

Ctrl+Shift+R se o CSS/JS parecer velho.

---

## 5. Caminho B — instalar do zero (os comandos da implantação)

Usa isto se **não** tem o `images/galene-local.tgz` e quer compilar o Galene.

### 5.1 Pasta

```bash
mkdir -p ~/docker/galene/{data,groups,recordings,static}
cd ~/docker/galene
```

### 5.2 Dockerfile (compila de um commit fixo, não do `master` vivo)

O original era `git clone --depth 1` (sempre o HEAD). Para **não** partir no dia seguinte, clona um commit ou usa a pasta `vendor/galene` do pacote.

Exemplo pinado (commit da implantação, 28/07/2026):

```dockerfile
FROM golang:1.24-alpine AS build
RUN apk add --no-cache git
WORKDIR /src
RUN git clone https://github.com/jech/galene.git . \
 && git checkout 9e03b36ba93f05e88fcfd6c3ea5468c16bcbae32
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /out/galene .
RUN mkdir -p /out/static && cp -a static/. /out/static/

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata \
 && adduser -D -u 1000 galene
WORKDIR /app
COPY --from=build --chown=galene:galene /out/galene /app/galene
COPY --from=build --chown=galene:galene /out/static /app/static
USER galene
ENTRYPOINT ["/app/galene"]
```

Com o pacote: `COPY vendor/galene/` em vez do `git clone` (é o que o `Dockerfile` do repo faz, se fores rebuildar).

### 5.3 compose.yaml (esqueleto)

Dois serviços, `network_mode: host`, `restart: unless-stopped`:

- **galene** — `image: galene:local`, `user: "1000:1000"`, volumes `./data`, `./groups`, `./recordings`, `./static:/app/static:ro`. Command: `-http :8443 -insecure -turn IP_PUBLICO:1194 -udp-range 50000-50100` + `-data` `/data` `-groups` `/groups` `-recordings` `/recordings` `-static` `/app/static`.
- **spartan-reg** — `python:3.12-alpine`, `python3 /app/registry.py`, volumes `./registry.py:/app/registry.py:ro`, `./data`, `./groups`.

IP do TURN no `.env` (`TURN_PUBLIC_IP`), **nunca** o da LAN.

Primeira subida com compile:

```bash
cd ~/docker/galene
docker compose build
docker compose up -d
```

Depois de estar bom, podes congelar:

```bash
docker save galene:local | gzip > images/galene-local.tgz
```

E no `compose.yaml` **tira** `build: .` para não recompilar por engano.

A revisão de 18/09/2026 (assinatura direcionada) **exige** recompilar `galene:local` e reiniciar **só** o container `galene`. Tag de rollback antes: `docker tag galene:local galene:local-rollback-AAAAMMDD`. Estáticos sobem depois do servidor (capacidade `spartan-request-by-id-v1` no handshake).

### 5.4 UI Spartan e sidecar

Copia para o servidor (do pacote ou do teu Git):

- `static/` inteiro (é a interface), **incluindo** `static/sounds/{entrar,sair,mensagem}.mp3` e o `index.html` da **landing** (não o admin)
- `registry.py`

Reinicia só o sidecar se mudares o Python:

```bash
docker restart spartan-reg
```

Estáticos: Ctrl+Shift+R (há `?v=` nos HTML; incrementa se o cache persistir).

### 5.5 UFW + proxy

Iguais à secção 4.4 e 4.6.

---

## 6. Comportamento (o que replicar na lógica)

- Home: botão lê `/spartan-api/site` + `/public-groups.json`. `static/index.html` é a landing — **nunca** a substituas por `admin.html`.
- `/salas/`: busca, A–Z ou Recentes, **5 linhas** de altura fixa; paginação se houver mais.
- Painel: **`/admin/`** (`static/admin/index.html`). A raiz `/` é a landing — nunca o login do admin.
- Sala pública: classe `html.spartan-open-room`, senha oculta; botão **fora** do `.connect` para login com conta cadastrada (`html.spartan-named-login`); `.login-box` com `height:auto` (a caixa não rebenta). Nick+senha só passam para a sala depois do Galene aceitar o join; senha errada fica no login (um toast, sem loop).
- Temporários = só salas **sem** senha de amigos. Convite = senha de amigos.
- **Cargos:** Admin (`op`) e Usuário (`present`). Criar conta: só nick; senha inicial `Mudar@123`; 1º login obriga troca. Ouvinte / convidado / temporário ficam no código para um módulo extra depois.
- **Cofre único (`data/accounts.json`):** senha e cargo das contas cadastradas ficam aqui; `/join-named` valida o cofre e sincroniza o user na sala Galene. Senha de convite de amigos é só daquela sala.
- Convidados sem pedido de cadastro saem da lista do painel após **24 h** (histórico em `access.log`).
- **Sair** limpa sessão. **Voltar à sala**: se a aba da call estiver aberta (`BroadcastChannel`), foca-a; senão reentra já logado. Não desloga a call.
- Sala: lives (foco, Tela/Câmera, olho verde/vermelho, fluência: live assistida **sempre** em vídeo alto, mesmo a transmitir). **Uma** live entra em foco; **duas** abrem **lado a lado** na primeira vez; 3–4 em grid 2×2. Fechar a câmera (X ou botão) **mantém o mic** se ele estiver ligado. Volume 0–400% e Mudo no menu do nick (PC clique; celular segurar 1 s, menu por cima do drawer); Mudo visível na lista só se amarelo/vermelho; admin pode silenciar o mic do outro. Sem Identificar e sem enviar arquivo no menu.
- Botão do painel nas configurações: `POST /can-panel` com `scope=admin` (**Painel Admin**) ou `scope=mod` (**Painel (moderador)**). Anfitrião 24h **não** vê. Criar canal de texto/voz fica no cartão do servidor no Painel, não na lista da casca.
- Inputs de senha: `autocomplete=off` / `new-password`. CSP do Galene **proíbe** JS inline (`onfocus=...`).
- Extra **pública** sempre ganha `ttl` 24h. Extra **convite** só se o painel marcar **Sala temporária (24h)** (`POST /create-room` com `ttl: true`). A main não expira. `BAN_IP = False` no Python; `True` se quiseres suspender IP 24 h.
- Contador `#spartan-ttl` reconstitui no `start()` (`sessionStorage spartanTtl:<grupo>` + `GET /temp-status`), inclusive no F5 e para op/admin.
- `writableGroups: true` no `config.json` para o painel criar/apagar salas.

API do sidecar (prefixo `/spartan-api`): `health`, `rooms` (com `online`, `live_s`, `live_active`), `site`, `beacon`, `status`, `temp-status`, **`presence`** (POST heartbeat/leave), **`presence-room`** / **`presence-user`** (timers da sala e do nick), `registry`, `site-home`, `rename-main`, `create-room` (`ttl`, `open`, `host` só com ttl), `join-named` (cofre → sync Galene), `can-panel`, `net-event` (público), `net-log` / `access-log` (admin), convites (`register`, `approve`, `quick`, `deny`, `block`, `unblock`, `forget`), **servidores** (`/servers`, `/server`, `/server-view`, `/server-create`, `/server-channel`, `/server-join` entra na hora, `/account-login`, `/server-guest`, `/server-invite` prévia do link, `/server-invite-rotate` troca o link, `/server-move`, `/server-moved`, `/server-here`, `/server-text`, `/server-file` — imagem/mp4/mp3 até 100 MB em `data/chat-files/`; Moderador só no sidecar; uma call Galene por vez), **`/panel-login`** (admin via cofre / `sidecar.auth`) e **`/gapi/*`**. O `/gapi` completa a barra final das listas (`.users/`); sem isso o Galene devolve `404 page not found` no login do painel. O painel **não** aceita o anfitrião temporário de uma sala 24h. Trocar senha pelo painel (`/gapi` POST `.password`) atualiza o cofre. Estado dos servidores: `data/servers.json` (não misturar com `registry.json`).

---

## 7. Customizar visual (cores, imagens, textos)

A UI **não** está “dentro” da imagem Docker no que o usuário vê: o volume `./static` **substitui** o static da imagem. Muda arquivos em `static/` e dá Ctrl+Shift+R. **Não** precisa rebuild.

### 7.1 Wallpaper

Arquivo: `static/papel-de-parede.jpg`

Referências CSS: `spartan.css`, `galene-spartan.css`, `admin.css` (url `/papel-de-parede.jpg?v=…`). Troca o JPG e **sobe o `?v=`** nos CSS/HTML para furar o cache.

Ícone: `static/icone-separtan.jpg` (podes substituir e apontar o HTML se usares favicon).

### 7.2 Cores (vermelho Spartan)

A paleta está sobretudo em:

| Arquivo | O quê |
|---|---|
| `static/spartan.css` | Home, botões, rodapé |
| `static/galene-spartan.css` | Sala (login overlay, toasts) |
| `static/admin.css` | Painel |
| `static/custom-home.css` | Extra da home |
| `static/spartan-pages.css` | Páginas auxiliares |

Cores típicas a procurar e trocar:

- `#dc2626` — vermelho da marca / bordas
- `#fecaca` — texto dos botões
- `#111` / `#1a0a0a` — fundo dos botões
- `#000` — fundo da página

Não apagues as regras do rodapé `footer.signature` (`position: fixed`, **sem** `border-top` grosso, fundo `rgba(0,0,0,.32)`), senão a barra **corta** o wallpaper. No celular o rodapé vai para **coluna** (Galene, o teu nome, o botão), para não encavalar.

### 7.3 Textos da home

`static/index.html`:

- `<title>`, `.spartan-brand` (nome do site), `.spartan-tag` (frase)
- Botão: o JS `custom-home.js` reescreve o texto com o nome da sala da home
- Rodapé **meio**: “Interface refeita por …” — põe o **teu** nome/link
- Rodapé **esquerda**: deixa **Galene / Juliusz** (obrigatório)

O mesmo rodapé existe em `salas/index.html`, `admin/index.html`, `galene.html`. Alinha os três.

### 7.4 Nome da sala / slug

Não basta mudar o HTML. No servidor:

1. `groups/MEU-SLUG.json`
2. `data/site.json` → `"main"` e `"home"`
3. Painel admin também pode **renomear** a main (`/rename-main`) e **definir como entrada** do site (`/site-home`)

Slug: minúsculas, letras, números, hífen, até 32 caracteres.

### 7.5 Fuso e purge

No topo de `registry.py`: `TZ = ZoneInfo("America/Sao_Paulo")`. Muda para o teu fuso. `BAN_IP = False` ou `True`.

Depois: `docker restart spartan-reg`.

### 7.6 Sala — microfone, tela e som do PC

Na sala, o microfone começa **desligado** (vermelho) em cada entrada — inclusive ao voltar do admin. O primeiro clique pede o microfone; os seguintes só mutam. A câmera fica num botão à parte. Ativar/Desativar da barra original estão escondidos.

Lives com imagem **não** entram sozinhas na tela: o botão verde (Câmera / Tela) vem do catálogo `spartanLivesV1` (metadados, **sem** baixar vídeo). Mic sozinho = só a bolinha. O clique pede só aquela live em alta (`requestStreamById` com `dest` + `id`, sem o campo `source`); outro clique (ou o X) tira e **para de baixar** (quem transmite segue). **Duas** lives já abrem **lado a lado** (a primeira em foco não deixa o grid numa coluna só). Fechar a câmera **não** desliga o microfone. Mensagem de texto abre o chat sozinho; dá para marcar **Não abrir o chat automaticamente**. Mensagens somem depois de **24 h**. Cada pessoa tem **Mudo** na lista (só no teu cliente). À esquerda do nome há uma bolinha: **cinza** (mic off), **amarelo** (mic ligado, parado), **verde** (falando), **vermelho** (mutado) — igual para si e para os outros. Sons curtos ao **entrar**, **sair** e **receber mensagem** (arquivos em `static/sounds/*.mp3`; cada um liga/desliga em Configurações e fica gravado neste computador para o teu nick). Header: ícones vermelhos, textos e nome da sala brancos; fundo do grid/lista `#33363d`. Salas permanentes mostram só o timer branco `HH:MM:SS` no header (**tempo da sala**, servidor: começa quando entra gente na call; vazio segue 5 min e zera). Tempo individual fica no menu do nick. Salas de 24h mostram à direita do nome: `Tempo até exclusão desta sala: HH:MM` (permanece no F5). Se a ligação cair, há graça de **60 s** (sem overlay no blip; mic/live preservados); só depois aparece **Ligação perdida**. O grid é de pares (1, 2, 4, 6… até 50). **Ocultar o meu** esconde as tuas imagens só para ti. Chat e definições abrem em janela por cima da sala (engrenagem, sem menu a deslizar). A janela de Configurações tem borda vermelha; o X de fechar (configurações, chat, lives e avisos) é um quadradinho vermelho com X branco. Configurações mostra só dispositivos e os três sons da sala; envio ilimitado, duas qualidades automático e a bolinha de fala ficam ligados por baixo, sem opções extra no menu.

Quem compartilha a tela e quer que os outros ouçam **o jogo e a voz** precisa dos **dois** ao mesmo tempo: microfone ligado **e** compartilhamento com áudio. No Chrome/Edge no **Windows**, no popup: escolhe **tela inteira** ou **aba**, e marca **compartilhar áudio**. Compartilhar só uma janela quase nunca traz o som do PC. No Linux o browser muitas vezes só captura áudio de aba; no Safari/iPhone não há áudio de sistema.

---

## 8. Segurança

1. Senhas **novas**. Nunca reutilizes as de outro servidor.
2. Não publiques `sidecar.auth`, `registry.json` com dados de pessoas, nem backup `.plain-bak`.
3. Não escrevas nomes de operadores no login do admin.
4. UFW: 1194 e UDP só o necessário; 8443/8091 de preferência LAN.

---

## 9. Comandos úteis no dia a dia

```bash
cd ~/docker/galene
docker compose ps
docker logs galene --tail 50
docker logs spartan-reg --tail 50
curl -sS http://127.0.0.1:8091/spartan-api/health; echo
curl -sS http://127.0.0.1:8091/spartan-api/site; echo
curl -4 ifconfig.me; echo
```

Mudança em `registry.py`: `docker restart spartan-reg`.  
Mudança em `static/`: Ctrl+Shift+R (e incrementa `?v=`).

`registry.json` às vezes fica `root:root` (o sidecar grava como root):

```bash
sudo chown "$USER:$USER" ~/docker/galene/data/registry.json
```

Backup da pasta (privado, tem hashes e `sidecar.auth`):

```bash
cd ~/docker
sudo zip -r ~/galene-backup-$(date +%Y%m%d-%H%M).zip galene \
  -x "galene/recordings/*" -x "galene/.plain-bak/*"
sudo chown "$USER:$USER" ~/galene-backup-*.zip
```

Congelar a imagem de novo:

```bash
docker save galene:local | gzip > ~/galene-local-image.tgz
```

---

## 10. Plano de reformulação (implantado)

Contrato depois do snapshot de garantia. Grid da sala e bolinhas de fala **não** mudaram.

| Fase | O quê |
|---|---|
| A | HUD só na live de quem transmite; mic com `voiceIsolation`; teto automático da tela; ICE sem loopback fora do lab |
| B | `registry.json` atômico; beacon/presence/net-event sem nick solto |
| C | senha admin só na sessão; `postMessage` com origem; `?v=` único; um painel (`/admin/`; `/painel/` redireciona) |
| D | `spartan-quality.js` / `spartan-net.js` / `spartan-watch.js` (sem mover o grid); testes alinhados |

Não entra: RNNoise/Krisp, REMB de volta, `forceRelay` global, gravar a sala.

No WSL Debian de desenvolvimento o Compose monta o `static/` e o `registry.py` do clone: mudou JS → Ctrl+Shift+R; mudou Python → `docker restart spartan-reg`. Não precisa copiar pacote.

---

## 11. Créditos

- **Galene** by [Juliusz Chroboczek](https://www.irif.fr/~jch/) — https://galene.org  
- A casca visual você pode tornar sua; **não apague** a atribuição do Galene no rodapé.
