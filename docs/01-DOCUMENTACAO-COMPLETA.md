# Spartan Chat (Galene) — documentação completa da implantação

**Data da implantação:** 20 de agosto de 2026  
**Objetivo deste arquivo:** registrar *como o stack ficou no teu servidor*, para operação, backup e GitHub.  
**Segredos:** nenhuma senha, hash, `sidecar.auth` ou credencial aparece aqui. Contas e senhas ficam só no servidor (`groups/*.json`, `data/config.json`, `data/sidecar.auth`).

A versão para mandar a um amigo (placeholders, sem IP/domínio teu) está em `02-DOCUMENTACAO-REPLICA-LIMPA.md`.

---

## 1. Contexto

Havia um **MiroTalk P2P** em `~/docker/mirotalk`. A sala abria, mas áudio/vídeo/tela giravam infinito: o Docker só fazia sinalização; a mídia WebRTC ia P2P e, em NAT/CGNAT/4G, **sem TURN** a rota nunca fecha.

O MiroTalk foi removido **só ele** (container + pasta), sem mexer nos outros stacks (NPM, Jellyfin, etc.).

No lugar entrou o **[Galene](https://galene.org)** (SFU + TURN nativo, Juliusz Chroboczek), com interface própria (“Spartan”) por cima dos estáticos.

---

## 2. Onde vive

| Item | Valor |
|---|---|
| Host | Debian (usuário `bresley`) |
| Pasta | `~/docker/galene` |
| IP LAN | `192.168.100.16` |
| IP público | `45.4.107.171` |
| Domínio | `https://chat.bresley.win` |
| Proxy | Nginx Proxy Manager (já existente) + SSL Cloudflare |
| Relógio | `America/Sao_Paulo` (limpeza de salas públicas na hora cheia) |

---

## 3. Arquitetura

```
Internet / 4G
    │  HTTPS 443 (Cloudflare)
    ▼
Nginx Proxy Manager
    │  /              →  192.168.100.16:8443   (Galene, WebSocket ligado)
    │  /spartan-api/  →  192.168.100.16:8091   (sidecar Python)
    ▼
Debian (Docker, network_mode: host)
    ├── galene          TCP 8443 (HTTP -insecure, TLS fica no NPM)
    │                   TURN TCP+UDP 1194
    │                   RTP UDP 50000–50100
    └── spartan-reg     TCP 8091  (registry.py)
```

`network_mode: host` é **obrigatório** para o TURN nativo anunciar o IP público certo. Sem isso o vídeo trava de novo (mesmo problema do MiroTalk).

O Galene sobe com `-http :8443 -insecure`. Quem termina TLS é o NPM.

---

## 4. Portas (firewall e roteador)

Abrir **no roteador (WAN → 192.168.100.16)** e no **UFW** do Debian:

| Porta | Protocolo | Serviço |
|---|---|---|
| 8443 | TCP | HTTP do Galene (só LAN/NPM; público entra no 443) |
| 8091 | TCP | API Spartan (NPM encaminha `/spartan-api/`) |
| 1194 | TCP **e** UDP | TURN nativo |
| 50000–50100 | UDP | Mídia RTP |

No log do Galene, `Relay test failed` no primeiro boot é normal **enquanto o 1194 WAN não estiver aberto**. Depois do encaminhamento, o TURN deve anunciar `Starting built-in TURN server on 45.4.107.171:1194`.

---

## 5. Containers e volumes

Imagem do Galene: **`galene:local`**, compilada no Docker a partir do Git (`github.com/jech/galene`), Go 1.24, Alpine.

```
~/docker/galene/
  Dockerfile
  compose.yaml
  registry.py              → /app/registry.py no sidecar
  static/                  → /app/static:ro no Galene (UI Spartan)
  data/                    → /data
      config.json
      registry.json        (convidados, temps, seen, pending…)
      site.json            (sala main + sala da home)
      sidecar.auth         (Basic da API; 0600; NÃO vai para Git)
      var/
  groups/                  → /groups  (um JSON por sala)
  recordings/              → /recordings
```

Serviços típicos no `compose.yaml`:

- **galene:** `network_mode: host`, `user: "1000:1000"`, volumes `data`, `groups`, `recordings`, `static`.
- **spartan-reg:** `python:3.12-alpine`, `network_mode: host`, comando `python /app/registry.py`, mesma pasta `groups` + `data`.

`writableGroups: true` no `data/config.json` permite criar/apagar salas e usuários pela API (o painel usa isso).

---

## 6. Nginx Proxy Manager

Host: `chat.bresley.win`

1. Forward: `http://192.168.100.16:8443`  
   Websockets **ligado**. SSL Cloudflare como já estava.
2. Custom Location: `/spartan-api/` → `http://192.168.100.16:8091`  
   (barra final importa; o sidecar aceita o prefixo e corta).

`canonicalHost` / `proxyURL` no Galene: `https://chat.bresley.win/`.

---

## 7. URLs públicas (sem `.html`)

| URL | Tela |
|---|---|
| `/` | Home (botão da sala marcada como home) |
| `/salas/` | Lista de outras salas (busca, A–Z / Recentes, 5 por página) |
| `/admin/` | Painel (login com wallpaper + rodapé) |
| `/group/<id>/` | Sala Galene (login Spartan + sala) |
| `/spartan-api/...` | API do sidecar |

Cópias estáticas: `static/salas/index.html` e `static/admin/index.html`.

---

## 8. Tipos de sala

| Tipo | Wildcard | Quem entra | Onde aparece no painel |
|---|---|---|---|
| **Pública** | `"password": {"type": "wildcard"}` | Só nick, sem senha | Temporários |
| **Convite** | senha de amigos (hash) | Nick + senha da sala | Convidados |
| **Principal (main)** | a que estiver em `data/site.json` → `main` | Igual ao tipo dela | Topo da aba Salas, **sem Apagar** |

Galene **não** aceita sala sem nenhum `wildcard-user`. Pública = wildcard tipo `wildcard`. Apagar a senha (DELETE password) gera `not authorised`.

`data/site.json`:

```json
{
  "main": "spartan",
  "home": "spartan"
}
```

- `main`: sala mestre, não se apaga pelo painel; pode mudar **título**, **slug/URL** e senha de amigos.
- `home`: qual sala o botão da landing abre. Pode ser outra (`Usar na home`).

Se a main for apagada por fora (API Galene crua), a home cai no primeiro grupo público da lista, ou tenta a URL morta da main.

---

## 9. Contas e senhas (política)

- Operadores da sala (`op`) e admins globais do `config.json` existem no JSON do Galene.
- Senhas no disco estão **hasheadas** (`pbkdf2` ou `bcrypt`). Texto puro não deve voltar a ser gravado.
- Pedidos de cadastro **não** guardam a senha em `registry.json` (só timestamp); a senha vai direto à API do Galene.
- `data/sidecar.auth` (`usuario:senha`, modo 0600) é o único segredo em claro que o sidecar usa para Basic na API interna. **Não commitar.**
- `BAN_IP` no `registry.py` está **desligado** (`False`) para testes; ligar de novo quando quiser o ban de 24h após o purge das públicas.

Nunca documente nem commite os valores de senha.

---

## 10. Sidecar `spartan-reg` (porta 8091)

Arquivo: `registry.py`. Endpoints úteis (prefixo `/spartan-api` opcional):

| Método | Caminho | Quem | Função |
|---|---|---|---|
| GET | `/health` | público | `{"ok": true}` |
| GET | `/rooms` | público | lista id, título, `open`, `updated` |
| GET | `/site` | público | `main` e `home` |
| GET | `/status` | público | status do nick (guest/temp/named/…) |
| GET | `/temp-status` | público | `open`, `purge`, `banned`, `taken` |
| GET | `/registry` | admin Basic | dump do registry |
| POST | `/beacon` | sala | IP + visto (`seen`; temps ou guests) |
| POST | `/register` `/approve` `/quick` `/deny` `/block` `/unblock` `/forget` `/stamp` | fluxos de convite | cadastro / moderação |
| POST | `/site-home` | admin | define sala da home |
| POST | `/rename-main` | admin | renomeia slug + título da main |

Purge das **públicas**: thread na **hora cheia** (Brasília). Incrementa `purge`; o cliente zera o chat e sai. Ban de IP 24h só se `BAN_IP = True`.

Beacon grava `seen[nick] = {first, last, ip}` para **todo mundo** (inclusive registrados), para o painel mostrar IP / sala / visto.

---

## 11. Interface Spartan (estáticos)

Volume `./static` por cima do static da imagem. Arquivos-chave:

- `index.html` + `custom-home.js` — home, botão segue `/spartan-api/site` + `public-groups.json`
- `salas/` — busca, ordenação, paginação (5 linhas de altura fixa)
- `admin/` — usuários, convidados, bloqueados, temporários, salas
- `galene.html` + `galene.js` + `galene-spartan.css` + `spartan-boot.js` — sala
- Wallpaper `papel-de-parede.jpg`
- Rodapé fixo: Galene / Juliusz (esquerda), “Interface refeita por wilbresley” (centro), Outras salas/Home (direita). Sem linha cinza; fundo semitransparente por cima da imagem.

Comportamentos de sessão:

- Login da sala **não** usa `autocomplete` de senha do Chrome.
- Sessão por sala em `sessionStorage` (`spartanSession:<grupo>`).
- **Sair** (sala ou painel) limpa tudo e marca `spartanLoggedOut`.
- **Voltar à sala** no painel **não** desloga.
- F5 na mesma sala reentra; ir para outra sala depois de Sair pede nick/senha.
- CSP do Galene bloqueia JS inline: não usar `onfocus="..."` nos inputs.

Painel admin:

- Login com wallpaper + rodapé; depois do login a caixa some (`#login-box[hidden]`).
- Não divulgar nomes de operadores na tela de login.
- Temporários = só salas `open` (sem senha).
- Listas: A–Z (padrão) ou Recentes; meta IP / sala / visto.
- Main no topo, sem Apagar; outras podem ir para a home.

---

## 12. Cliente da sala

- Erros do Galene traduzidos (ex.: `not authorised` → PT).
- Sala pública: campo senha oculto (`html.spartan-open-room`).
- Histórico de chat pulado para guests/temps e antes do timestamp `created`.
- “Solicitar registro” só para convite, não para pública.
- Sem kick HTTP nativo: o cliente sai sozinho no purge / bloqueio.

---

## 13. Comandos úteis no Debian

```bash
cd ~/docker/galene
docker compose ps
docker logs galene --tail 50
docker logs spartan-reg --tail 50
curl -sS http://127.0.0.1:8091/spartan-api/health; echo
curl -sS http://127.0.0.1:8091/spartan-api/site; echo
```

Rebuild da imagem Galene (só se mudar o Dockerfile):

```bash
cd ~/docker/galene
docker compose build --no-cache galene
docker compose up -d
```

Mudança só em `static/` ou `registry.py`: em geral **não** precisa rebuild; `docker restart spartan-reg` se o Python mudou. Estáticos: Ctrl+Shift+R (query `?v=`).

`registry.json` às vezes fica `root:root` (o sidecar grava como root). Para editar no host:

```bash
sudo chown "$USER:$USER" ~/docker/galene/data/registry.json
```

---

## 14. Backup (estado atual)

Ver `03-COMANDO-BACKUP.md`. O zip do servidor é a cópia fiel (inclui hashes e `sidecar.auth`). Este repositório Git **não** inclui esse zip.

---

## 15. Linha do tempo (o que foi feito neste dia)

1. Diagnóstico MiroTalk (WebRTC sem TURN).
2. Remoção só do stack MiroTalk.
3. Galene compilado em Docker, `host` network, TURN no IP público, RTP 50000–50100.
4. NPM 8443 + UFW/roteador 1194 e UDP.
5. UI Spartan: home, wallpaper, rodapé, PT-BR, sala `spartan`.
6. Painel admin, convites, wildcard, salas públicas vs convite.
7. Sidecar 8091: registry, beacon, temps, purge na hora cheia.
8. Senhas hasheadas; sessão/autofill; Sair vs Voltar à sala.
9. Temporários só em sala sem senha; IP/visto em todos; ordenação.
10. Outras salas: busca, 5 por página, altura fixa.
11. Sala main protegida; home apontável; `/admin/` e `/salas/` sem `.html`.
12. Login com wallpaper/rodapé; rodapé sem cortar a arte.

---

## 16. Créditos

- **Galene** by [Juliusz Chroboczek](https://www.irif.fr/~jch/) — <https://galene.org>
- Interface Spartan — [wilbresley](https://github.com/wilbresley)
