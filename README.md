# Galene — edição Spartan (the gratis)

Videoconferência **auto-hospedada** com [Galene](https://galene.org) (Juliusz Chroboczek) + interface **Spartan** (PT-BR) + sidecar Python.

Este repositório é a versão **pública e pronta para clonar**: sem dados de produção de ninguém. Vem com a **mesma imagem Docker** `galene:local` já empacotada e um script que sobe tudo de uma vez.

| | |
|---|---|
| **Licença** | MIT (Galene + interface deste repo) |
| **Repo privado de origem** | desenvolvimento interno — este aqui é o pacote limpo |
| **Imagem** | `images/galene-local.tgz` → `galene:local` (~9 MB) |
| **Login fábrica** | `admin` / `Mudar@123` (obrigatório trocar no 1º login) |

---

## Subir em 1 comando (Linux / Debian / Ubuntu / WSL2)

Pré-requisito: [Docker](https://docs.docker.com/engine/install/) + plugin **Compose v2**.

### Opção A — rápido (senha de fábrica)

```bash
git clone https://github.com/wilbresley/galene-edicao-spartan-the-gratis.git
cd galene-edicao-spartan-the-gratis
chmod +x scripts/subir.sh
./scripts/subir.sh
```

Login fábrica: `admin` / `Mudar@123` (troque no 1º login).

### Opção B — instalador completo (recomendado para produção)

Pergunta IP, domínio, nome da sala e senhas. **Sempre cria sala CONVITE** (nunca pública no início).

```bash
git clone https://github.com/wilbresley/galene-edicao-spartan-the-gratis.git
cd galene-edicao-spartan-the-gratis
chmod +x scripts/instalar-completo.sh
./scripts/instalar-completo.sh
```

No final o script lista o que você ainda precisa fazer no DNS, Nginx/NPM, firewall e roteador (TURN/portas).

Pronto. Abra:

- Home: http://127.0.0.1:8443/
- Sala: http://127.0.0.1:8443/group/spartan/
- Admin: http://127.0.0.1:8443/admin/

```text
usuário: admin
senha:   Mudar@123
```

No primeiro login o sistema pede **duas senhas novas** (admin + convidados da sala).

Parar: `docker compose down`  
Logs: `docker compose logs -f`

> **Windows nativo:** o `compose.yaml` usa `network_mode: host` (pensado para Linux). Use **WSL2** ou um VPS Linux. Em Windows puro o host-network do Docker Desktop não funciona igual.

---

## O que é este projeto?

| Peça | Função |
|---|---|
| **Galene** | SFU + TURN: áudio/vídeo/tela entre várias pessoas |
| **static/** | Interface Spartan (home, salas, admin, sala ao vivo, `sounds/*.mp3`) |
| **registry.py** | Sidecar (`spartan-reg`): convites, temporários, logs, IDs, beacon |
| **groups/spartan.json** | Sala principal (modo **convite** na fábrica) |
| **data/** | Config, contas, registry, sidecar.auth |

### Cargos (3)

| Cargo | Código | Pode |
|---|---|---|
| **Admin** | `op` | Moderação + tudo |
| **Verificado** | `present` | Lives, transmitir, chat texto e voz |
| **Ouvinte** | `["present"]` sem message | Só voz — sem lives, sem texto, sem transmitir vídeo |

- **Convidado** (sala com senha de amigos) nasce **Verificado**
- **Temporário** (sala pública) nasce **Ouvinte**

---

# Tutorial — nível Júnior

Siga na ordem. Se algo falhar, leia a seção **Problemas comuns**.

### 1. O que você precisa

- Um computador ou VPS com **Linux** (Debian/Ubuntu recomendado) **ou** Windows com **WSL2**
- ~1 GB livre de disco
- Portas livres (pelo menos **8443**; para internet completa também **1194** e UDP **50000–50100**)

### 2. Instalar Docker (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"
# saia e entre de novo no SSH/terminal para o grupo docker valer
```

Teste: `docker run --rm hello-world`

### 3. Clonar e subir

```bash
git clone https://github.com/wilbresley/galene-edicao-spartan-the-gratis.git
cd galene-edicao-spartan-the-gratis
chmod +x scripts/subir.sh
./scripts/subir.sh
```

O script:

1. Cria `.env` (IP público para TURN, se conseguir detectar)
2. Garante os arquivos de `data/` e `groups/` da fábrica
3. Faz `docker load` da imagem do repo
4. Roda `docker compose up -d`

### 4. Entrar na sala

1. Abra http://127.0.0.1:8443/group/spartan/
2. Nick: `admin` — senha: `Mudar@123`
3. Troque as senhas quando o modal pedir
4. Painel: http://127.0.0.1:8443/admin/ (mesma conta admin)

### 5. Convidar um amigo na mesma rede

Na LAN: use o IP do servidor, ex. `http://192.168.x.x:8443/group/spartan/`  
Ele entra com nick + **senha de amigos** (a que você definiu no 1º login).

### 6. Colocar na internet (visão júnior)

1. Apontar um domínio (ex. `chat.seudominio.com`) para o IP do VPS  
2. Colocar **Nginx Proxy Manager**, Caddy ou Nginx na frente (HTTPS)  
3. No proxy: WebSocket ligado; destino `http://IP_LAN:8443`  
4. Liberar no firewall/roteador: **1194/tcp+udp** (TURN) e **50000–50100/udp** (RTP)  
5. Editar `data/config.json`: `proxyURL` e `canonicalHost` com o **seu** domínio  
6. Reiniciar: `docker compose restart`

Detalhes extras: pasta `docs/`.

### 7. Problemas comuns (júnior)

| Sintoma | O que fazer |
|---|---|
| `permission denied` no Docker | `sudo usermod -aG docker $USER` e relogar |
| Página não abre | `docker compose ps` — containers `up`? |
| Áudio/vídeo falha fora da LAN | TURN/IP público no `.env` + portas abertas |
| Senha errada | Fábrica é `Mudar@123` só até o 1º login |
| Mudou CSS/JS e não vê | Ctrl+Shift+R (hard refresh) |

---

# Tutorial — nível Sênior

### Arquitetura

```
Cliente (browser)
    │  HTTPS (seu proxy)  →  :8443  Galene (-insecure; TLS no proxy)
    │  /spartan-api/*     →  :8091  spartan-reg (registry.py)
    │
    ├── WebRTC media via SFU Galene
    └── TURN anunciado em TURN_PUBLIC_IP:1194
         RTP UDP 50000–50100
```

`network_mode: host` evita NAT hairpin do Docker bridge no TURN/RTP.

### Volumes

| Host | Container | Notas |
|---|---|---|
| `./data` | `/data` | config, sidecar.auth, registry, accounts, access.log |
| `./groups` | `/groups` | JSON das salas |
| `./static` | `/app/static:ro` | UI Spartan por cima do static da imagem |
| `./recordings` | `/recordings` | gravações (se habilitar) |

### Segredos e o que este repo **traz** de propósito

| Arquivo | No Git público? | Motivo |
|---|---|---|
| `data/sidecar.auth` | **Sim** (fábrica) | `admin:Mudar@123` — só bootstrap; troque |
| `data/config.json` / `groups/spartan.json` | **Sim** | hashes da senha de fábrica |
| `.env` | **Não** (gitignore) | IP TURN da sua máquina |
| `data/access.log` / `registry` com gente real | **Não** | gerados em runtime |

Em produção: troque senhas, restrinja o repo se for fork privado, `chmod 600 data/sidecar.auth`.

### API do sidecar (`registry.py`)

Prefixo típico via proxy: `/spartan-api/…`

Principais: `health`, `rooms`, `site`, `beacon`, `status`, `temp-status`, `access-log`, `registry`, `panel-login`, `first-setup`, `rename-user`, convites (`register`, `approve`, …), proxy `gapi/*` da API Galene.

Sala pública: `ensure_open_ouvinte` no beacon alinha wildcard para Ouvinte (`["present"]`).

### Customizar UI

Tudo em `static/`. Suba o `?v=` nos HTML/CSS ao publicar assets. Wallpaper: `static/papel-de-parede.jpg`. Sons: `static/sounds/{entrar,sair,mensagem}.mp3`.

### Rebuild da imagem Galene (opcional)

O caminho padrão é **não** rebuildar: use `images/galene-local.tgz`.

Se quiser recompilar: `Dockerfile` + `vendor/galene/` (fonte pinada). Depois `docker save galene:local | gzip > images/galene-local.tgz`.

### Proxy / Cloudflare

- WebSocket obrigatório no path do Galene  
- Encaminhar `CF-Connecting-IP` / XFF se quiser IP real nos logs  
- `proxyURL` / `canonicalHost` coerentes com o domínio público  

### Factory reset

Ver `factory-reset/README.md`. Zera para só `admin` + senha de fábrica.

### Documentação longa

- `docs/02-DOCUMENTACAO-REPLICA-LIMPA.md` — instalação do zero (sem dados pessoais)
- `docs/01-DOCUMENTACAO-COMPLETA.md` — referência operacional (placeholders neste fork)
- `docs/03-COMANDO-BACKUP.md` — backup da pasta

---

## Comandos úteis

```bash
./scripts/subir.sh          # bootstrap completo
./scripts/load-image.sh     # só recarregar a imagem
docker compose up -d
docker compose logs -f galene
docker compose logs -f spartan-reg
docker compose restart spartan-reg   # depois de editar registry.py
docker compose down
```

---


## Para uma IA te ajudar a instalar

Pede para a IA ler o arquivo [INSTALACAO-PARA-IA.md](INSTALACAO-PARA-IA.md). Ela vai te perguntar domínio, IP, sala, senhas, etc., e montar os arquivos/comandos.

Ou rode o instalador interativo (sempre sala **convite**):

```bash
chmod +x scripts/instalar-completo.sh && ./scripts/instalar-completo.sh
```

## Créditos

- **Galene** — Juliusz Chroboczek e contribuidores  
- **Interface Spartan / sidecar / este pacote** — [wilbresley](https://github.com/wilbresley)

Contribuições e issues: abra no GitHub deste repositório.
