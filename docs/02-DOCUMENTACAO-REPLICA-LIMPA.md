# Galene + interface Spartan — guia para replicar (limpo)

Este texto **não contém** domínio, IP, senha nem nick da implantação original. Serve para instalar **do zero** no teu servidor, com as **tuas** contas, cores e imagens.

Software de base: **[Galene](https://galene.org)** (Juliusz Chroboczek). “Spartan” é a casca: HTML/CSS/JS + sidecar Python.

Há **dois caminhos**:

| | Quando usar |
|---|---|
| **A — pacote pronto** | Alguém te passou o repo (ou um zip limpo). Mais rápido. |
| **B — do zero** | Queres repetir o raciocínio da implantação original, comando a comando. |

Os dois terminam no mesmo tipo de stack. Sempre **as tuas** senhas e o **teu** domínio.

---

## 0. O que este stack faz (modificações em cima do Galene)

O Galene oficial sobe uma videoconferência SFU + TURN. Por cima foi feita uma interface e um serviço extra:

1. **Home** com wallpaper, marca, botão da sala da home, contador de gente online.
2. **`/salas/`** — lista outras salas (busca, A–Z / Recentes, 5 linhas de altura fixa).
3. **`/admin/`** — painel (usuários, convites, bloqueados, temporários, salas). Login com o mesmo visual da home.
4. **Sala** `/group/<id>/` — login no estilo da home; sala **pública** esconde senha; sala **convite** pede senha de amigos.
5. **Sidecar** `registry.py` na porta **8091**, no proxy em `/spartan-api/`.
6. Salas **públicas** (só nick) vs **convite** (nick + senha de amigos).
7. Sala **principal** (`site.json` → `main`) não apaga pelo painel; **home** pode apontar para outra.
8. Purge das públicas **na hora cheia** (fuso no Python). Cliente sai sozinho.
9. Senhas no disco **hasheadas**. `sidecar.auth` é o único segredo em claro (chmod 600).
10. Rodapé: crédito **obrigatório** do Galene/Juliusz; o do meio podes trocar pelo teu nome.

Isto **não** é o MiroTalk. MiroTalk P2P trava em NAT/4G sem TURN. Galene relê a mídia.

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
| **443** | TCP | HTTPS no proxy (único que o utilizador vê) |
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

Se tens o Git (repo privado, convite, ou zip **sem** `sidecar.auth` / `registry.json` / salas reais):

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
- `data/site.json` — `"main"` e `"home"` = slug do ficheiro (ex.: `sala-principal`)
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
| `/admin/` | Painel |
| `/group/sala-principal/` | Sala (ajusta o slug) |

Ctrl+Shift+R se o CSS/JS parecer velho.

---

## 5. Caminho B — instalar do zero (os comandos da implantação)

Usa isto se **não** tens o `images/galene-local.tgz` e queres compilar o Galene.

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

### 5.4 UI Spartan e sidecar

Copia para o servidor (do pacote ou do teu Git):

- `static/` inteiro (é a interface)
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

- Home: botão lê `/spartan-api/site` + `/public-groups.json`.
- `/salas/`: busca, A–Z ou Recentes, **5 linhas** de altura fixa; paginação se houver mais.
- `/admin/`: **não** uses `/admin.html` na barra de endereço (há `static/admin/index.html`).
- Sala pública: classe `html.spartan-open-room`, campo senha oculto.
- Temporários = só salas **sem** senha de amigos. Convite = senha de amigos.
- **Cargos:** Admin (`op`), Verificado (`present`), Ouvinte (`["present"]` sem message). Temporário nasce Ouvinte; convidado nasce Verificado.
- **Sair** limpa sessão. **Voltar à sala** no admin **não** desloga.
- Sala: lives (foco, Tela/Câmera, olho verde/vermelho, fluência: só a assistida em vídeo alto); volume 0–400% e Mudo no menu do nick (PC clique; telemóvel segurar 1 s, menu por cima do drawer); Mudo visível na lista só se amarelo/vermelho; admin pode silenciar o mic do outro. Sem Identificar e sem enviar arquivo no menu.
- Inputs de senha: `autocomplete=off` / `new-password`. CSP do Galene **proíbe** JS inline (`onfocus=...`).
- Purge das públicas na hora cheia (`TZ` em `registry.py`, default `America/Sao_Paulo`).
- `BAN_IP = False` no Python; `True` se quiseres suspender IP 24 h após o purge.
- `writableGroups: true` no `config.json` para o painel criar/apagar salas.

API do sidecar (prefixo `/spartan-api`): `health`, `rooms`, `site`, `beacon`, `status`, `temp-status`, `registry`, `site-home`, `rename-main`, convites (`register`, `approve`, `quick`, `deny`, `block`, `unblock`, `forget`), **`/panel-login`** (valida op/admin da sala ou `sidecar.auth`) e **`/gapi/*`** (proxy da API admin do Galene). O painel aceita a **mesma conta op** com que entras na sala (não a senha de amigos); as chamadas ao Galene usam o `sidecar.auth` por baixo.

---

## 7. Customizar visual (cores, imagens, textos)

A UI **não** está “dentro” da imagem Docker no que o utilizador vê: o volume `./static` **substitui** o static da imagem. Mudas ficheiros em `static/` e dás Ctrl+Shift+R. **Não** precisas rebuild.

### 7.1 Wallpaper

Ficheiro: `static/papel-de-parede.jpg`

Referências CSS: `spartan.css`, `galene-spartan.css`, `admin.css` (url `/papel-de-parede.jpg?v=…`). Troca o JPG e **sobe o `?v=`** nos CSS/HTML para furar o cache.

Ícone: `static/icone-separtan.jpg` (podes substituir e apontar o HTML se usares favicon).

### 7.2 Cores (vermelho Spartan)

A paleta está sobretudo em:

| Ficheiro | O quê |
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
3. Painel admin também pode **renomear** a main (`/rename-main`) e “Usar na home”

Slug: minúsculas, letras, números, hífen, até 32 caracteres.

### 7.5 Fuso e purge

No topo de `registry.py`: `TZ = ZoneInfo("America/Sao_Paulo")`. Muda para o teu fuso. `BAN_IP = False` ou `True`.

Depois: `docker restart spartan-reg`.

### 7.6 Sala — microfone, tela e som do PC

Na sala, o microfone começa **desligado** (vermelho) em cada entrada — inclusive ao voltar do admin. O primeiro clique pede o microfone; os seguintes só mutam. A câmera fica num botão à parte. Ativar/Desativar da barra original estão escondidos.

Lives com imagem **não** entram sozinhas no ecrã: aparece um botão verde (Câmera / Tela) sob o nick; o clique abre no teu grid, outro clique tira. Só áudio não ganha botão nem tile. Cada pessoa tem **Mudo** na lista (só no teu cliente). À esquerda do nome há uma bolinha: **cinza** (mic off), **amarelo** (mic ligado, parado), **verde** (falando), **vermelho** (mutado) — igual para si e para os outros. A grelha é de pares (1, 2, 4, 6… até 50). **Ocultar o meu** esconde as tuas imagens só para ti. Chat e definições abrem em janela por cima da sala (engrenagem, sem menu a deslizar).

Quem partilha o ecrã e quer que os outros ouçam **o jogo e a voz** precisa dos **dois** ao mesmo tempo: microfone ligado **e** partilha com áudio. No Chrome/Edge no **Windows**, no popup: escolhe **ecrã inteiro** ou **aba**, e marca **partilhar áudio**. Partilhar só uma janela quase nunca traz o som do PC. No Linux o browser muitas vezes só captura áudio de aba; no Safari/iPhone não há áudio de sistema.

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

## 10. Créditos

- **Galene** by [Juliusz Chroboczek](https://www.irif.fr/~jch/) — https://galene.org  
- A casca visual podes tornar tua; **não apagues** a atribuição do Galene no rodapé.
