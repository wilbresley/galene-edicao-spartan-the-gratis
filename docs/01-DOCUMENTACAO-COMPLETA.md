# Spartan Chat (Galene) — documentação completa da implantação

**Data da implantação:** 20 de agosto de 2026  
**Última revisão deste documento:** 18 de setembro de 2026 (padrão ouro de lives/reconexão; painel do moderador; criar canal só no Painel)  
**Objetivo deste arquivo:** registrar *como o stack ficou no teu servidor*, para operação, backup e GitHub.  
**Segredos:** nenhuma senha de produção, hash real do servidor, `sidecar.auth` vivo ou credencial operacional aparece aqui. Contas e senhas **da instalação** ficam só no servidor (`groups/*.json`, `data/config.json`, `data/sidecar.auth`).  
**Exceção documentada:** o pacote `factory-reset/` traz a senha de fábrica `Mudar@123` (admin, contas novas e convidados) de propósito — só para zerar o Docker; no primeiro login **todo mundo** troca a senha. Admin também troca a senha dos convidados da sala.

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
| Relógio | `America/Sao_Paulo` (salas extra de 24h; a principal não expira) |

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

Imagem do Galene: **`galene:local`**. O `compose.yaml` **não** faz `build` no dia a dia. Em 18/09/2026 a imagem precisa ser **recompilada** (assinatura direcionada `requestStreamById` no `vendor/galene`). Antes: `docker tag galene:local galene:local-rollback-20260918`. Depois: `docker build -t galene:local .` a partir do repo e `docker compose up -d --force-recreate --no-deps galene` (só esse container). Fonte pinado em `vendor/galene`.

```
~/docker/galene/
  Dockerfile
  images/galene-local.tgz  imagem Docker exata (docker load)
  vendor/galene/           fonte do Galene congelado (rebuild opcional)
  compose.yaml
  registry.py              → /app/registry.py no sidecar
  static/                  → /app/static:ro no Galene (UI Spartan)
  data/                    → /data
      config.json
      registry.json        (convidados, temps, seen, pending…)
      servers.json         (servidores, canais, membros, convite, chat texto)
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
| `/` | Home: nick + senha da conta; **Convidado?** (`#/convidado`) ou link de convite `#/i/<código>` |
| `/salas/` | Lista de outras salas (busca, A–Z / Recentes, 5 por página) |
| `/admin` | Painel. Neste Galene isso é um **arquivo** `static/admin` (cópia do HTML). Se `static/admin` for **pasta**, `/admin` dá 404. |
| `/group/<id>/` | Sala Galene (login Spartan + sala) |
| `/spartan-api/...` | API do sidecar |

Cópias estáticas: `static/salas/index.html` e `static/painel/index.html`.

---

## 8. Tipos de sala

| Tipo | Wildcard | Quem entra | Prazo |
|---|---|---|---|
| **Principal (main)** | senha de amigos (hash) na instalação | Nick + senha da sala | **Não** some sozinha |
| **Convite extra** | senha de amigos (hash) | Nick + senha da sala | Definitiva **ou** 24h (opção no painel) |
| **Pública extra** | `"password": {"type": "wildcard"}` | Só nick (temporário) **ou** conta cadastrada | Some em **24h** |

No painel, **Criar sala** padrão é **convite definitiva**. Dá para marcar **Sala temporária (24h)** no convite, ou criar **pública** (sempre 24h). Anfitrião só nas de 24h: `op` daquela sala, **nunca** entra no `/admin/`.

Galene **não** aceita sala sem nenhum `wildcard-user`. Pública = wildcard tipo `wildcard`. Apagar a senha (DELETE password) gera `not authorised`.

`data/site.json`:

```json
{
  "main": "spartan",
  "home": "spartan"
}
```

- `main`: sala mestre, não se apaga pelo painel; pode mudar **título**, **slug/URL** e senha de amigos.
- `home`: qual sala o botão da landing abre. Pode ser outra (`Usar na home`), **exceto** salas de 24h.

Se a main for apagada por fora (API Galene crua), a home cai no primeiro grupo público da lista, ou tenta a URL morta da main.

---

## 9. Contas, senhas e cargos

### 9.1 Senhas (política)

- Operadores da sala (`op`) e admins globais do `config.json` existem no JSON do Galene.
- Senhas no disco estão **hasheadas** (`pbkdf2` ou `bcrypt`). Texto puro não deve voltar a ser gravado nas salas.
- Pedidos de cadastro **não** guardam a senha em `registry.json` (só timestamp); a senha vai direto à API do Galene.
- `data/sidecar.auth` (`usuario:senha`, modo 0600) é o único segredo em claro que o sidecar usa para Basic na API interna. **Não commitar** (está no `.gitignore`).
- `BAN_IP` no `registry.py` está **desligado** (`False`) para testes; ligar de novo quando quiser o ban de 24h após o purge das públicas.

Nunca documente nem commite senhas **de produção**.

### 9.2 Cargos na sala (Admin e Usuário)

| Cargo (UI) | Valor Galene | Quem nasce assim | Pode |
|---|---|---|---|
| **Admin** | `op` | conta admin | painel + tudo |
| **Usuário** | `present` (string → present+message) | conta criada no painel (nick só) | lives, transmitir, chat texto e voz |

- Criar usuário no painel: **só o nick**. Senha inicial de todo mundo: `Mudar@123`. No primeiro login a pessoa **tem** que trocar (`must_change` + modal). Admin no 1º login ainda troca a senha dele **e** a dos convidados da sala (`/first-setup`); usuário comum só a própria (`/first-password`).
- Cargos convidado / ouvinte / temporário ficam **arquivados** no código (wildcard, abas Convidados/Temporários) para um módulo extra depois (compatibilidade Zulip). Não aparecem no menu de cargo.
- Tipo de entrada (cadastrado / convidado / temporário) ≠ cargo. Nos logs, “Admin (painel)” é só o evento de login no `/admin`.
- Sala pública: o sidecar (`ensure_open_ouvinte` no beacon) ainda alinha o wildcard antigo; o menu de cargo do painel não oferece Ouvinte.
- Sala convite: wildcard permanece Usuário (`present`).
- Painel: menu de cargo Admin / Usuário; arraste `⋮⋮` das salas **só na aba Servidores**; a ordem (texto sempre acima da voz) vale na lista da sala.

---

## 10. Sidecar `spartan-reg` (porta 8091)

Arquivo: `registry.py`. Endpoints úteis (prefixo `/spartan-api` opcional):

| Método | Caminho | Quem | Função |
|---|---|---|---|
| GET | `/health` | público | `{"ok": true}` |
| GET | `/rooms` | público | lista id, título, `open`, `ttl`, `expires_at`, `remaining_s`, `host` |
| GET | `/site` | público | `main` e `home` |
| GET | `/status` | público | status do nick (guest/temp/named/…) |
| GET | `/temp-status` | público | `open`, `purge`, `banned`, `taken`, `ttl`, `expires_at`, `remaining_s`, `host` |
| GET | `/access-log` | admin Basic | últimas entradas de `data/access.log` (JSONL, ~1 ano) |
| GET | `/net-log` | admin Basic | oscilações WS em `data/net.log` (JSONL, 30 dias, sem dedupe) |
| GET | `/registry` | admin Basic | dump do registry |
| POST | `/beacon` | sala (nick+senha; pública = só nick) | IP + visto; gravação atômica (`mutate_registry`); em sala pública chama `ensure_open_ouvinte` |
| POST | `/presence` | sala (nick+senha; pública = só nick) | heartbeat / leave; devolve `room_live_s` e `user_live_s` |
| GET | `/presence-room` | público | tempo da sala + opcional tempo do nick |
| GET | `/presence-user` | público | tempo individual do nick |
| GET | `/must-change` | público | sempre `{must_change: false}` — não vaza se o nick existe |
| POST | `/must-change` | sala (nick+senha da conta) | `{must_change, admin}` só com senha certa |
| POST | `/register` `/approve` `/quick` `/deny` `/block` `/unblock` `/forget` `/stamp` | fluxos de convite | cadastro / moderação. `/quick` sem senha usa `Mudar@123` e marca `must_change` |
| POST | `/reset-factory-password` | admin | volta a senha do nick para `Mudar@123` e exige troca no próximo login |
| POST | `/panel-login` | painel | admin global (`scope=admin`) **ou** moderador/dono de servidor (`scope=mod`) |
| POST | `/can-panel` | sala | igual ao panel-login, **sem** gravar log; devolve `{ok, scope}` |
| POST | `/net-event` | sala (nick+senha se o nick não for `?`) | cliente reporta queda/recuperação WS (código, duração, se recuperou) |
| POST | `/join-named` | sala extra | valida conta da main e copia o user (Usuário, nunca op) para a sala extra |
| POST | `/create-room` | admin | cria sala extra: `open` (pública = 24h) ou convite; `ttl` opcional no convite; anfitrião só se `ttl` |
| POST | `/first-setup` | admin | troca senha admin + amigos no 1º login |
| POST | `/first-password` | conta com `must_change` | troca só a senha do usuário no 1º login |
| POST | `/rename-user` | admin | renomeia por ID imutável |
| POST | `/site-home` | admin | define sala da home |
| POST | `/rename-main` | admin | renomeia slug + título da main |
| GET | `/servers` | membro (`?user=`) | só os servidores em que o nick **já é membro** (oficial também exige lista); sem nick, lista vazia; cada item traz `text_heads` (contagem do chat, sem o texto) |
| GET | `/server` | membro | detalhe + presença; **401** sem nick, **403** sem acesso |
| GET | `/server-text` | membro | últimas mensagens do canal só-texto |
| GET | `/server-file` | membro (`?id=&server=&user=`) | baixa imagem/mp4/mp3 do chat (até 100 MB) |
| GET | `/server-invite` | público | prévia do convite (`?code=`) |
| POST | `/server-create` | admin global | cria servidor extra (não aninha servidor) |
| POST | `/server-channel` | admin ou moderador daquele servidor | canal voz (grupo Galene) ou só-texto |
| POST | `/server-join` | conta + código ou link | entra **na hora** (membro); soma o servidor na lista |
| POST | `/server-approve` `/server-deny` | admin ou moderador | aprova/recusa no sidecar |
| POST | `/server-mod` | **admin global** | marca Moderador **só no sidecar** (`galene_perm` continua `present`); o nick já precisa ter acesso |
| POST | `/server-member-add` | admin/mod daquele servidor | inclui cadastrado que ainda não tem acesso; se estiver na call de outro, some da lista na hora |
| POST | `/server-member-remove` | admin/mod daquele servidor | tira o acesso e **expulsa da call** (`kicks`); mod não tira outro mod/dono |
| POST | `/server-addable` | admin/mod daquele servidor | cadastrados **sem** acesso (para a janela Adicionar) |
| POST | `/user-servers` | admin global | todos os servidores de um nick, com `has` + botões de incluir/tirar |
| POST | `/server-kicked` | a vítima | confirma que aplicou a expulsão |
| POST | `/server-here` | membro | presença em canal de texto |
| POST | `/server-text` | membro (não ouvinte) | mensagem no chat do servidor |
| POST | `/server-file` | membro (não ouvinte) | multipart: imagem, mp4 ou mp3 até 100 MB em `data/chat-files/` |
| POST | `/server-view` | membro (nick+senha) | detalhe com convite/pendentes/`members` se puder gerir; **403** sem acesso |
| POST | `/account-login` | conta | valida senha; devolve só os servidores com acesso, `home` vazio se não tiver nenhum, `panel_scope` |
| POST | `/server-guest` | nick + senha 2× + convite (código ou link `#/i/…`) | cria conta e entra no servidor na hora |
| POST | `/server-move` | admin/mod | arrasta nick para um canal de voz (inclui Ausentes) |
| POST | `/server-moved` | a vítima | confirma que aplicou a troca |
| POST | `/server-invite-rotate` | admin ou moderador | gera **link novo**; o antigo deixa de valer |
| POST | `/server-delete` | admin/dono | apaga servidor extra; o oficial **não apaga** |
| * | `/gapi/*` | admin | proxy da API Galene (`/galene-api/v0/...`). Coleções (`.users/`, `.groups/`, `.tokens/`) ganham barra final aqui — sem isso o Galene responde `404 page not found` e o texto aparece embaixo do **Entrar** no painel. |

Salas **extra** de 24h: o sidecar apaga o JSON do grupo quando `expires_at` chega (a cada ~20 s). Quem está dentro vê à **direita do nome da sala** `Tempo até exclusão desta sala: HH:MM`. O relógio liga no boot da página (`temp-status` + `sessionStorage spartanTtl:<grupo>`), então **sobrevive a F5 / rejoin** — não depende do submit do login. A **main** não entra neste prazo. Públicas extra que já existiam sem prazo ganham 24h no próximo start do sidecar. Ban de IP 24h só se `BAN_IP = True` (desligado).

Beacon grava `seen[nick] = {first, last, ip}` para **todo mundo** (inclusive registrados), para o painel mostrar IP / sala / visto. IP prefere `CF-Connecting-IP` / hops úteis do XFF. `load`/`save` do `registry.json` usam trava + arquivo `.tmp` (`mutate_registry`).

**Lab WSL (este PC):** stack em `/home/docker/galene`. O Compose monta `GALENE_SRC` = pasta do Cursor (`static/` e `registry.py`). Mudou o JS: só **Ctrl+Shift+R**. Mudou o Python: `docker restart spartan-reg`. Não precisa `cp` de pacote no lab. Produção (`~/docker/galene` no Debian) continua pelo pacote `galene-sala-static`. Zerar o lab: `scripts/reset-lab.ps1` (reaplica `factory-reset/`, inclusive senha de fábrica; **não** puxa `data/` nem `groups/` do repo).

---

## 11. Interface Spartan (estáticos)

Volume `./static` por cima do static da imagem. Arquivos-chave:

- `index.html` + `custom-home.js` — **landing** em `/`: só nick + senha; **Convidado?** ou o link `#/i/<código>` cria conta já no servidor. Quem já tem conta loga e o convite soma o servidor. Logado vê um cartão para confirmar. **Nunca** copiar o painel por cima de `index.html`. Login do painel: **`/admin/`** (`static/admin/index.html`). `/painel/` só redireciona.
- `salas/` — busca, ordenação, paginação (5 linhas de altura fixa)
- `admin/` — usuários, convidados, bloqueados, temporários, logs, **oscilações**, salas, **servidores**
- `galene.html` + `galene.js` + `spartan-quality.js` + `spartan-net.js` + `spartan-watch.js` + `galene-spartan.css` + `spartan-boot.js` — sala
- Wallpaper `papel-de-parede.jpg`
- Sons da sala `static/sounds/` — `entrar.mp3`, `sair.mp3`, `mensagem.mp3` (vão no Git; o instalador avisa se faltarem)
- Rodapé fixo: Galene / Juliusz (esquerda), “Interface refeita por wilbresley” (centro). Sem lista **Outras salas** na home nem no rodapé da call.

Comportamentos de sessão:

- Login da sala **não** usa `autocomplete` de senha do Chrome. A tela da sala **só** aparece depois do Galene aceitar nick+senha (`joined`); senha errada fica no login, um toast, sem reconectar em loop.
- Sessão por sala em `sessionStorage` (`spartanSession:<grupo>`) — gravada **só** depois do join certo.
- **Sair** (sala ou painel) limpa tudo e marca `spartanLoggedOut`.
- **Voltar à sala** no painel: se a aba da call responder (`BroadcastChannel spartan-room`), foca-a e tenta fechar o admin; senão copia o login para `spartanSession:<sala>` e reentra já autenticado. **Não** abre a call na aba do painel se ela já existir.
- F5 na mesma sala reentra; ir para outra sala depois de Sair pede nick/senha.
- Contador 24h (`#spartan-ttl`) reconstitui no `start()` (não só no submit do login): `spartanTtlRestore` + `GET /temp-status`. Anfitrião/op também faz poll.
- CSP do Galene bloqueia JS inline: não usar `onfocus="..."` nos inputs.
- Admin SSO: senha do painel **só** em `sessionStorage` (`spartanAdmin`). O `localStorage.spartanAdminHandoff` antigo é apagado se ainda existir. Preferências de qualidade (HUD, 720p, modo jogo) ficam em `localStorage.spartanPrefs` **sem** senha.
- Cache dos JS/CSS da sala: query `?v=` em `galene.html` (hoje `galene.js?v=136`, `spartan-quality.js?v=1`, `spartan-net.js?v=1`, `spartan-watch.js?v=1`, `settings.js?v=2`, `galene-spartan.css?v=104`, `protocol.js?v=9`, `toastify.js?v=3`, `spartan-boot.js?v=11`). Home shell: `spartan-shell.js?v=9`, `spartan-shell.css?v=32`, `spartan-servers.js?v=24`, `custom-home.js?v=10`. Painel: `admin.js?v=52`, `admin.css?v=37`, `spartan.css?v=24`. **`registry.py`**: reiniciar `spartan-reg` após mudanças no sidecar. Painel canónico em **`/admin/`** (`static/admin/index.html`). `/painel/` e `painel.html` só redirecionam para `/admin/`. Nunca copiar o painel por cima de `index.html` da raiz.

Painel admin:

- Login com wallpaper + rodapé; depois do login a caixa some (`#login-box[hidden]`).
- Não divulgar nomes de operadores na tela de login.
- Temporários = só salas `open` (sem senha).
- Cadastrados: ID + nome à esquerda; à direita Detalhes, cargo e pares **Renomear / Redefinir senha** e **Excluir / Bloquear** (largura do texto + padding). **Detalhes** expande sala, IP e último visto.
- Senha dos amigos **só na aba Salas** (por sala). A aba Usuários não duplica isso.
- Listas: A–Z (padrão) ou Recentes.
- Main no topo, sem Apagar; outras podem ir para a home.
- Cargos: Admin / Usuário na call (Galene). **Moderador** é cargo do sidecar **por servidor** — na call ele continua Usuário.
- Logs: filtros por tipo, nick e IP; horário Brasília.
- **Oscilações:** aba própria; `data/net.log` 30 dias; filtros nick/sala/IP; cada queda conta.
- **Criar sala:** convite definitiva (padrão); checkbox **Sala temporária (24h)**; pública sempre 24h; bloco anfitrião só aparece com ttl.
- **Servidores:** aba no painel. **Admin global** vê tudo. **Moderador** só esta aba e só os servidores em que é membro. Spartan oficial também exige convite/inclusão (não entra todo verificado). Cartão tem **Usuários** (busca, remover, adicionar cadastrado que ainda não tem acesso). Aba Usuários (só admin) tem **Servidores** por pessoa. Campo de moderador lista quem já tem acesso. Convite é **link eterno** (`origem/#/i/<código>`); **Trocar link** invalida o antigo. Quem abre o link cria a conta já naquele servidor, ou (se já tem conta) loga e entra; logado confirma num cartão. Categorias só Texto / Voz. Quatro colunas: ícones, canais, grid (espaço exclusivo), membros (ocultos, cada um numa caixinha). Clicar em texto abre janela **por cima do grid** (não troca a call). Chat Geral aceita colar print e enviar imagem / mp4 / mp3 até **100 MB** (`POST /server-file`, arquivos em `data/chat-files/`). O overlay do chat **abre na mensagem mais nova**. Só outra voz ou Ausentes desconecta. No canal de voz: quadrados **Tela/Câmera** (sempre visíveis se a pessoa estiver transmitindo — inclusive a live do outro); **Mudo** nas cores antigas (cinza / amarelo no teu fone / vermelho o mic dele / os dois); **volume** só ao clicar na pessoa (0–400%, passo 5%, % na barra, rodinha do mouse). **Não** arrasta usuário/canal na lista — mover gente entre vozes e ordem de canais só no **Painel Admin**. Aba **Salas** do painel: sala principal + extras de verdade; canal de voz de servidor **não** entra em Temporárias (24h) e **não** some sozinho. Barra: mic, tela, câmera, engrenagem, Sair. Paleta cinza estilo Fluxer; vermelho só acento.

---

## 12. Cliente da sala

- Erros do Galene traduzidos (ex.: `not authorised` → PT).
- Sala pública: campo senha oculto por defeito (`html.spartan-open-room`); botão **Entrar com conta cadastrada** / **Entrar como temporário** (`html.spartan-named-login`) fica **fora** do `.connect` para a caixa não rebentar. `.login-box` usa `height:auto`.
- Histórico de chat: mensagens com mais de **24 h** não entram na caixa (e as que já estavam saem). Guests/temps continuam sem histórico antigo; o corte `created` segue igual. Mensagem nova abre o chat (quem pode texto), salvo **Não abrir o chat automaticamente** (fica neste browser).
- “Solicitar registro” só para convite, não para pública.
- Sem kick HTTP nativo: o cliente sai sozinho no purge / bloqueio.
- Multi-live: botão **Tela** só no compartilhamento de tela; **Câmera** só com faixa de vídeo (mic sozinho = só a bolinha, sem texto Câmera). Cabeçalho preto acima do vídeo.
- **Fluência:** live **assistida** (clicada) pede sempre vídeo alto — câmera `['audio','video']`; tela `['video']` e só inclui áudio se o espectador ligar o volume da tile. **Nunca** `video-low`. Tela que **envias**: FPS-alvo **60** (`frameRate` ideal/max sem `min` — Chrome rejeita `min` no getDisplayMedia), `maxFramerate` + `maintain-framerate`, `contentHint=motion` (modo jogo). Bitrate da tela **independente** do “Enviar” da câmera: teto auto **12 Mbps**, 1080p **10 Mbps**, 720p **5 Mbps**, com **escada automática** (`availableOutgoingBitrate`) se o upload apertar (pode cair a 30 fps). Offer da screenshare **sem `goog-remb`**. HUD **só na tua live** (`enviando · alvo · fps · kbps/teto`). Quem assiste não vê FPS. Oscilar em torno do teto (com pico curto acima) é normal. Receivers assistidos: `degradationPreference=maintain-resolution`. Voz da sala (mic/câmera) continua no fone sem clicar. Mic com supressão ligada pede `echoCancellation` / `noiseSuppression` / `autoGainControl` / `voiceIsolation`. **Padrão ouro das lives:** o botão Tela/Câmera vem do catálogo `spartanLivesV1` em `user.data`, **sem** baixar mídia. Pedido padrão `{'': ['audio'], screenshare: []}`. Antes do clique não existe downstream de tela, nem `RTCPeerConnection` receptor, nem RTP de vídeo. No clique o cliente pede só aquela live com `requestStreamById` (`dest` = publisher + `id` = streamId — **não** o campo `source`, que o Galene fecha com "spoofed client id"; capacidade `spartan-request-by-id-v1` no handshake) em qualidade alta. Fechar cancela só essa assinatura; o indicador permanece enquanto a origem transmite. Intenção de assistir fica em `nick + liveKey` (várias telas). Volume da tile começa mudo. F5/foco voltam mudos; desconexão reconstitui quais telas tinham som ligado. ICE ignora `127.0.0.1`/`::1` fora do lab; ICE restart só da live que caiu.
- **Painel** (botão nas configurações da casca): `POST /can-panel` com `scope=admin` (**Painel Admin**, tudo) ou `scope=mod` (**Painel (moderador)**, só aba Servidores dos que tem). Usuário comum **não** vê. Anfitrião 24h **não** vê. Criar canal de texto/voz é **só** no cartão do servidor nesse painel — a lista da casca não tem atalho.
- **Uma** live na sala: já entra em foco; clique extra nela não faz nada. Duas lives: **lado a lado** já na primeira abertura (o foco automático da primeira não deixa o grid numa coluna só). Três ou quatro: grid 2×2. Clique escolhe o foco.
- **Minhas lives:** ícones de olho; verde = mostrando, vermelho = ocultando. O X nas lives dos outros **para de assistir** (não baixa mais o vídeo; a transmissão dela segue). O X na **própria** live **para** aquele share. Fechar a **câmera** (header ou X) com o mic ligado **mantém o microfone**; o ícone verde do mic acompanha o estado real.
- Engrenagem: rótulo **Configurações**. Painel só com o que a sala usa: perfil (trocar senha / admin), dispositivos (câmera, microfone, espelhar, ruído, áudio HQ) e **Sons da sala** (entrada, saída e mensagem, cada um à parte). As escolhas de som ficam em `localStorage` por nick neste browser. Fora do menu (fixo por baixo): envio **ilimitado**, duas qualidades **automático** (no Firefox, desligado), receber **tudo**, filtros desligados, modo quadro desligado, detectar atividade **sempre ligado** (é a mesma lógica da bolinha).
- **Sair** no cabeçalho (vermelho `#dc2626`), com confirmação.
- **Ouvinte** legado (`body.spartan-ouvinte`): ainda no cliente para o módulo extra depois; o painel não cria mais este cargo.
- Lista de usuários: clique esquerdo (PC) abre o menu. No **celular**, o drawer da lista desliza da esquerda; o menu do usuário só com **segurar 1 s**, em `position:fixed` por cima do drawer (`z-index` alto). Soltar o dedo **não** fecha o menu (o clique sintético é ignorado ~900 ms).
- Menu do outro usuário (lista da sala, fora da casca): **Mudo** (só o teu fone), **Volume (seu fone)** 0–400% em passos de 5%, e se for admin: apresentar / **Silenciar microfone** (muta o mic **dele** para toda a sala) / Expulsar. Sem Identificar (não manda IP) e sem enviar arquivo.
- Na **casca** (lista do canal de voz): barra de volume **só ao clicar** na pessoa (0–400%, passo 5%, porcentagem, rodinha); Tela/Câmera na linha dela (própria e dos outros); Mudo cinza / amarelo / vermelho / os dois; sem arrastar usuário na lista.
- Bolinha: **cinza** off; **amarelo** mic ligado parado; **verde** falando; **vermelho** mutado. Publish segue a **faixa** (`enabled`+`live` → `on`; senão `localMute` → `muted`) e reenvia o estado a cada ~2,5 s. Nos outros, `micstate === 'muted'` é absoluto (analisador/stats não pintam amarelo). Desmutar / falar com faixa viva publica `on` mesmo que o `localMute` da sessão tenha ficado preso.
- Sons da sala (`static/sounds/`): `entrar.mp3`, `sair.mp3`, `mensagem.mp3`. Toca para os **outros** (não para você, não no histórico, não no lote dos 1,5 s ao entrar). Configurações: três interruptores (entrada / saída / mensagem), ligados por padrão, gravados neste computador por nick. O browser só libera o áudio depois do primeiro clique/tecla.
- Queda da ligação, depois que você já entrou: **graça de 60 s** (corte único).
  - Snapshot de uplinks/watch/som **antes** do `protocol.js` fechar PC e streams (`onbeforeclose`). Tracks locais sobrevivem; PC/timers fecham sem deixar órfão (`sc.up = {}` proibido).
  - **&lt; 60 s:** reconecta em silêncio (sem overlay), **não** força mute e republica mic/câmera/tela no mesmo estado (`hadCamera` = vídeo real; `hadMicOnly` = só áudio; nunca promove mic-só a câmera). Flag `_spartanRecoveringMedia`. Geração monotônica: callback antigo não dá join na conexão nova. Tentativa só termina após `gotJoined('join')`, republicação e restauração das lives que você já assistia. O Galene larga o peer no servidor — os outros podem ver um piscar; no seu PC a mídia local fica.
  - **≥ 60 s:** fecha ups locais (`closeUpMedia`), limpa o snapshot, mostra overlay **Ligação perdida** e trata como queda. Ao voltar depois disso, entra “limpo” (mic desligado; precisa religar tela/câmera).
  - Tentativas: silencioso ~1,5 s na graça; depois do overlay, 2 s / ~2,5 s e evento `online`/`offline`. **Sair**, `/leave` e kick não entram nesta graça. Cada blip/recuperação/queda → `POST /net-event`.
- Botão **Câmera**/**Tela** sob o nick: só com vídeo/tela reais (`streamHasRealVideo` / `screenshare`). Mic sozinho = bolinha; sem atalho `camlive` para inventar botão Câmera.
- Header da sala permanente: timer branco `HH:MM:SS` = **tempo da sala** (servidor). Entra gente na call → começa a contar; sala vazia continua **5 min** e depois **para e zera**. Menu do nick: **tempo individual** na sala (também do servidor). `pagehide` avisa saída para o registry.
- Avisos Toastify (erro/aviso/info) e `#spartan-toast`: caixa **preta** com borda vermelha 2px. O X de fechar (toasts, Configurações, chat e lives) é um `×` branco em Arial (o `✖` do Toastify no Windows vira emoji roxo). Botão **Chat do Canal** com texto centrado; sininho à direita só com mensagens por ler.
- Header da sala: fundo preto, linha vermelha embaixo; **ícones** vermelhos (verde quando mic/câmera/tela estão ligados); **textos** dos itens (Microfone, Câmera, etc.) e o **nome da sala** em branco. Em salas de 24h, à **direita do nome**: `Tempo até exclusão desta sala: HH:MM` (permanece no F5 / rejoin). Lista de nicks à esquerda: caixinhas pretas com borda vermelha; fundo do grid e da lista `#33363d`. Sidebar com `border-right` vermelho 4px. Janelas (configurações, chat, convite, menus) borda vermelha 2px e cantos 12px.
- Volume acima de 100% usa Web Audio (`GainNode`); até 100% usa `media.volume`. Não altera o que os outros ouvem.

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

Rebuild da imagem Galene **só se quiser sair da imagem congelada**:

```bash
cd ~/docker/galene
docker compose build --no-cache galene
docker compose up -d
```

No dia a dia: `docker load -i images/galene-local.tgz` e `docker compose up -d`, **sem** `--build`.

Mudança só em `static/` ou `registry.py`: em geral **não** precisa rebuild; `docker restart spartan-reg` se o Python mudou. Estáticos: Ctrl+Shift+R (query `?v=`).

`registry.json` às vezes fica `root:root` (o sidecar grava como root). Para editar no host:

```bash
sudo chown "$USER:$USER" ~/docker/galene/data/registry.json
```

---

## 14. Backup e GitHub

- Pasta do servidor: `03-COMANDO-BACKUP.md` (zip **privado**, tem hashes e `sidecar.auth`).
- Imagem Docker: `docker save galene:local | gzip > ~/galene-local-image.tgz` — cópia no Git em `images/galene-local.tgz`.
- Repo privado: https://github.com/wilbresley/galene-edicao-spartan — **sem** senhas. Clone + `docker load` + `compose up -d`.
- Repo público (pacote para clonar): https://github.com/wilbresley/galene-edicao-spartan-the-gratis
- Histórico desta conversa Cursor (privado): `docs/exports/` e `docs/conversas-ia/` — markdown + JSONL para importar noutro chat. Comece por `docs/exports/RESUMO-CONVERSA-20260917.md`.

A pasta Windows `S:\Downloads\galene-spartan-docs\` tem as mesmas docs + export do chat.

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
11. Sala main protegida; home apontável; painel em `/admin`; `/salas/` sem `.html`.
12. Login com wallpaper/rodapé; rodapé sem cortar a arte.
13. Documentação + repo Git privado `wilbresley/galene-edicao-spartan`.
14. Fonte Galene congelado em `vendor/galene` (commit `9e03b36`).
15. Imagem `galene:local` no repo (`images/galene-local.tgz`); compose **sem** `build`.
16. Sala (24/08/2026): fluência das lives, Minhas lives, Sair no header, overlay de reconexão, Configurações só com dispositivos/sons, toasts pretos com X branco, nicks pretos, fundo `#33363d`, labels e nome da sala brancos, sons `static/sounds/*.mp3` no Git.
17. Salas extra: **pública sempre 24h**; **convite** definitiva (padrão) ou 24h (checkbox); anfitrião só nas de 24h (`op` da sala, sem `/admin/`); login público em dois modos (temporário / conta cadastrada).
18. Contador `Tempo até exclusão desta sala: HH:MM` à **direita do nome**; reconstitui no boot (`spartanTtlRestore` + `GET /temp-status`) e no rejoin/F5 (também para op/admin).
19. 25/08/2026: `/` = landing (nunca o login admin); live assistida sempre em vídeo alto; botão Painel só via `can-panel`; graça WS 30 s; Voltar à sala foca a aba da call; log de oscilações 30 dias; cadastrados com Detalhes expansíveis. Cache: `galene.js?v=81`, `custom-home.js?v=3`, `admin.js?v=32`, `admin.css?v=22`.
20. 25/08/2026: mic não mostra Câmera (só bolinha); Tela/Câmera só com live de verdade; chat abre sozinho (checkbox para não abrir); mensagens somem em 24 h. Grid/lives iguais ao item 19. Cache: `galene.js?v=90`, `galene-spartan.css?v=74`. Painel: `/admin/` (pasta `static/admin/index.html`).
21. 25/08/2026: login do painel não trava mais no `404 page not found` (a lista de usuários ia para `/spartan-api/gapi`; o painel que funcionava usa `/galene-api/v0`, com fallback). Cache: `admin.js?v=33`.
22. 25/08/2026: botão **Câmera** no nick e ícone do header só com faixa de vídeo real (`streamHasRealVideo`); mic sozinho não marca `spartanHasVideo` só porque o Galene chama o stream de `camera`. Cache: `galene.js?v=91`.
23. 25/08/2026: quem transmite câmera avisa os outros com `camlive` no `setdata` — o botão Câmera aparece no PC mesmo antes de pedir o vídeo alto. Mic continua sem botão. Cache: `galene.js?v=92`.
24. 25/08/2026: senha errada não entra na sala nem fica em loop de toast. O WebSocket conecta, mas a UI da canal só abre no `joined`; falha de auth volta ao login (um aviso) e não dispara a graça de 30 s. Cache: `galene.js?v=93`.
25. 25/08/2026: duas lives abrem **lado a lado** já na primeira vez. Fechar a câmera no celular **não** mata o microfone nem deixa o ícone verde; vira de novo só áudio. Cache: `galene.js?v=94`.
26. 01/09/2026: **shell SPA** na home; modo jogo; tela 720p/1080p; HUD FPS/bitrate; VP8 primeiro. Espelho público alinhado.
27. 01–04/09/2026: lista de salas sem 24h; slug aleatório; login entre salas.
28. 04/09/2026: **presença no servidor** — header = tempo da sala (`HH:MM:SS`); menu nick = tempo individual; sala vazia > 60 s zera; APIs `/presence`, `/presence-room`, `/presence-user`. **Reconexão** graça 60 s. Cache: `galene.js?v=110`+. Reiniciar `spartan-reg`.
29. 04/09/2026: botão **Câmera**/**Tela** só com vídeo/tela reais (`hadMicOnly`); recover sem mute forçado. Cache: `galene.js?v=112`.
30. 04/09/2026: **tela Full HD jogável** — FPS-alvo 60; bitrate auto 12 / 1080p 10 / 720p 5 Mbps; bypass REMB (~200 kbps) no offer da screenshare; HUD `alvo · fps · kbps/teto`; contador branco (`galene-spartan.css?v=99`). Cache: `galene.js?v=115`.
31. 09/09/2026: **som da tela** — live de tela só executa no clique; áudio da screenshare começa mudo (ícone bate com o estado); F5/foco não religam o som; desconexão reconstitui quais telas o usuário tinha com volume. Cache: `galene.js?v=116`.
32. 09/09/2026: **timer da sala** — conta só com gente na call; vazio segue 5 min e zera (não mais 60 s nem relógio inflado de tick antigo). Reiniciar `spartan-reg`.
33. 09/09/2026: **fechar live** — X ou segundo clique em Tela/Câmera para de assistir só no teu lado (não baixa mais o vídeo; quem transmite segue). Cache: `galene.js?v=117`.
34. 09/09/2026: **snapshot de garantia** no Git (privado + público) **antes** da reformulação: som da tela, timer 5 min, fechar-live, lab WSL. Commit `9a6a6a7`.
35. 09/09/2026: **reformulação** — HUD só no envio; mic `voiceIsolation`; teto adaptativo da tela; ICE sem loopback fora do lab; `registry.json` atômico + auth em beacon/presence/net-event; `must-change` GET não vaza nick; senha admin só na sessão; `postMessage` com origem; `?v=` alinhado; painel único `/admin/`; filtro blur escondido; `galene.js` quebrado em `spartan-quality.js` / `spartan-net.js` / `spartan-watch.js` (grid e bolinhas intactos). Lab WSL já serve `galene.js?v=118`. Reiniciar `spartan-reg`. Este commit é o estado implantado (depois do snapshot `9a6a6a7`).
36. 17/09/2026: **shell Fluxer** — home nick+senha; tela Convidado (senha 2× + convite); preset Voz 1–3 + Chat Geral + Ausentes; convite entra na hora; texto não troca o iframe da voz; arrastar entre vozes; toasts quietos. Reiniciar `spartan-reg`.
37. 17/09/2026: **casca da sala** — iframe só o grid (sem header/lista/chat velhos); Chat Geral ao logar; gente no canal com avatar + bolinha de mic; barra com mic, tela, engrenagem e Sair. Cache `galene.js?v=121`, `spartan-boot.js?v=11`.
38. 17/09/2026: **layout em colunas** — grid na coluna inteira (chat por cima, não ao lado); membros com botão discreto. Cache `galene-spartan.css?v=103`.
39. 17/09/2026: **chat com arquivo + lives na casca** — preset só Chat Geral (texto extra pelo admin); colar print / imagem / mp4 / mp3 até 100 MB em `data/chat-files/`; Tela/Câmera, volume e mudo debaixo do nick no canal; botão câmera. Cache `galene.js?v=122`.
40. 17/09/2026: **grid na casca** — `#peers` volta a ser grade (Tela 1 / Tela 2 lado a lado); sem ícone de olho; clicar no quadrado da *sua* live só oculta no teu grid. Cache `galene.js?v=123`, `galene-spartan.css?v=104`, `spartan-shell.css?v=18`, `spartan-servers.js?v=8`.
41. 17/09/2026: **troca de voz com salvaguarda** — mic sozinho troca na hora; tela/câmera ou live assistida abre cartão no meio da tela (Ficar / Trocar). Lista de membros compacta (bola + nome na mesma linha). Cache `spartan-servers.js?v=10`, `spartan-shell.css?v=20`.
42. 17/09/2026: **canais por servidor** — ID `servidor__canal` (Voz 1 da Tardis ≠ Voz 1 do Spartan). Painel lista, renomeia e apaga canal. Cache `spartan-servers.js?v=11`, `admin.js?v=43`. Reiniciar `spartan-reg`.
43. 17/09/2026: **call não cai ao olhar outro servidor** — ícone do servidor só troca texto/membros; mic, lives e tela seguem. Só entra na voz nova se clicar num canal de voz. Engrenagem esconde o chat por cima, abre o menu de configurações (e o admin); se não estiver em call, abre o painel direto. Cache `galene.js?v=124`, `spartan-servers.js?v=12`, `spartan-shell.css?v=21`.
44. 17/09/2026: **admin de servidores** — cartão por servidor, colunas texto/voz; poll sem piscar (só redesenha se mudou); Sair com cartão flutuante (sem `confirm` nativo); login/convidado centralizados. Cache `admin.js?v=44`, `admin.css?v=31`, `spartan-servers.js?v=13`, `spartan-shell.css?v=22`.
45. 17/09/2026: **acesso por lista** — verificado só vê servidor convidado/adicionado (Spartan oficial inclusive). Moderador no painel só aba Servidores dos que tem. Janela Usuários no cartão (busca, remover, adicionar); aba Usuários com Servidores por pessoa. Tirar alguém expulsa da call na hora. Cache `admin.js?v=45`, `admin.css?v=32`, `spartan-servers.js?v=14`, `custom-home.js?v=7`. Reiniciar `spartan-reg`.
46. 17/09/2026: **apagar canal de verdade** (não volta no fim da lista); janela de membros lista cadastrado mesmo sem login; confirmação na frente; botão verde **Adicionar e remover usuários**. Cache `admin.js?v=46`, `admin.css?v=33`. Reiniciar `spartan-reg`.
47. 17/09/2026: **1º login** exige troca das senhas de fábrica na casca (não só na call). Preset por servidor: Chat Geral, Voz 1 e Ausentes **fixos** (renomeia, não apaga; Ausentes sempre `key=ausentes` + 🔇); Voz 2/3 apagam. Arrasta `⋮⋮` para reordenar. Engrenagem abre configurações (admin é botão de dentro). Cache `custom-home.js?v=8`, `spartan-servers.js?v=15`, `spartan-shell.css?v=23`, `admin.js?v=47`, `admin.css?v=34`. Reiniciar `spartan-reg`.
48. 17/09/2026: **Painel Admin só para admin** nas configurações. Convite vira **link eterno** `#/i/<código>`; **Trocar link** gera outro e o antigo cai. Conta nova pelo link já entra no servidor; quem já tem conta loga e o convite soma o servidor; logado confirma num cartão (Não só fecha). Cache `galene.js?v=126`, `custom-home.js?v=10`, `spartan-servers.js?v=17`, `spartan-shell.js?v=8`, `spartan-shell.css?v=24`, `admin.js?v=49`, `admin.css?v=35`. Reiniciar `spartan-reg`.
49. 17/09/2026: **chat de texto** — janela de configurações cola no conteúdo; botão amarelo **Chat** (some ao abrir); mensagem nova no servidor em foco abre o overlay (por canal dá para **Não abrir sozinho**); outro servidor só ponto no ícone + som, **botão direito** silencia. Cache `spartan-servers.js?v=18`, `spartan-shell.css?v=25`. Reiniciar `spartan-reg`.
50. 17/09/2026: **aba Salas** — canais de voz dos servidores (Ausentes, Voz 2/3, slug do outro servidor) saem da lista de temporárias e **não** ganham prazo de 24h nem somem sozinhos. Abrir aponta para a casca (`/#/s/…` / `/#/group/…`), não para o login velho `/group/`. Cache `admin.js?v=50`. Reiniciar `spartan-reg`.
51. 17/09/2026: **lista de voz** — barra de volume só ao clicar na pessoa; botões Tela/Câmera ficam visíveis; Mudo nas cores antigas (amarelo / vermelho / os dois). Chat abre na mensagem mais nova. Cache `spartan-servers.js?v=19`, `spartan-shell.css?v=26`.
52. 18/09/2026: **lista de voz** - sem arrastar usuário (só admin move); volume 0–400% com % e rodinha; botão Tela/Câmera do outro aparece ao receber a live; clique no botão da própria live não trava. Cache `galene.js?v=128`, `spartan-servers.js?v=20`, `spartan-shell.css?v=28`.
53. 18/09/2026: **padrão ouro de lives e reconexão** — catálogo `spartanLivesV1` (botão sem mídia); assinatura Galene `requestStreamById` (`dest`=publisher + `id`=streamId — **não** `source`, que o Galene trata como spoof); pedido padrão `screenshare: []` (sem `video-low`); clique pede só aquela live em alta; fechar cancela a assinatura. Snapshot **antes** do close do socket; tracks preservadas; geração por tentativa; graça 60 s. Recompilar imagem `galene:local`. Cache `galene.js?v=130`, `protocol.js?v=6`, `spartan-servers.js?v=23`, `spartan-shell.css?v=29`.
54. 18/09/2026: **fix spoofed client id** — clique em Tela do outro usava `source` no pedido e o servidor fechava o WS em loop (toasts + som de entrar/sair). Agora `dest` + anti-loop em erro de protocolo. Cache `galene.js?v=130`, `protocol.js?v=6`.
55. 18/09/2026: **rótulo % do volume** na lista de voz — a linha não estoura mais a caixa (`padding-left` em vez de `width`+margem); `100%`/`400%` cabem inteiros. Cache `spartan-shell.css?v=30`.
56. 18/09/2026: **lives estáveis + % embaixo** — cancelar/assistir não derruba o WS (`requestStreamById` soft-fail se stream sumiu; cancela limpa o mapa direcionado); sem reabrir PC em toda renegociação; varre slots órfãos pretos; `%` do volume fica sob a barra. Cache `galene.js?v=131`, `protocol.js?v=7`, `spartan-shell.css?v=31`. Recompilar `galene:local`.
57. 18/09/2026: **fechar live assistida sem DC** — ao cancelar, `requestStream`/`answer`/`ICE` em id já fechada não derrubam o WS; tela cancela com `ById([])` (sem `pc.close` local — isso disparava ICE failed→negotiate→DC); câmera volta a `ById(['audio'])`; `Stream.request`/`abort` ignoram stream `_closed`; 404 no iframe chama `SpartanApp.goHome`. Cache `galene.js?v=134`, `protocol.js?v=9`, `spartan-shell.js?v=9`. Imagem `galene:local` recompilada no lab.
58. 18/09/2026: **X do grid = botão Tela/Câmera** — o X só oculta a própria live / para de assistir (mesmo `spartanToggleLive`); limpa intenção por sid+liveKey para a borda branca não ficar presa. Engrenagem sempre abre a telinha minimalista do shell (`spartan-shell-settings`), nunca o painel antigo da sala no iframe. Cache `galene.js?v=135`, `spartan-servers.js?v=22`.
59. 18/09/2026: **preset Spartan + painel** — `Ausentes` (fixo) volta a ser criado se faltar mesmo com servidor já existente; instalação do zero mantém Chat Geral + Voz 1/2/3 + Ausentes. Painel: nomes das salas centralizados (espaço reservado sem Apagar). Cache `admin.js?v=51`, `admin.css?v=36`. Reiniciar `spartan-reg`.
60. 18/09/2026: **X da própria live + painel/moderador** — X na sua tela/câmera encerra o compartilhamento (X nos outros só para de assistir); engrenagem mostra Painel também para moderador; lista alfabética de mods com Remover; criar canal mantém Texto/Voz; layout nome/botões + Apagar opaco nas fixas; vermelho só exclusão. Cache `galene.js?v=136`, `spartan-servers.js?v=23`, `spartan-shell.css?v=32`, `admin.js?v=52`, `admin.css?v=37`.
61. 18/09/2026: **sem atalho de criar canal na lista** — a coluna de canais do servidor não tem mais campo “Novo canal”; criar texto/voz fica só no cartão do servidor no Painel. Cache `spartan-servers.js?v=24`.

---

## 16. Plano de reformulação (implantado 09/09/2026)

Contrato cumprido depois do snapshot `9a6a6a7`. Grid (`resizePeers`, CSS de `.peer`, `showHideMedia` de layout, `gotDownStream` estrutural) e **bolinhas de fala** não mudaram de comportamento.

### A — Live e áudio (sala) — feito

1. HUD de qualidade **só na live de quem transmite** (envio). Quem assiste não vê FPS.
2. Microfone: com “Supressão de ruído” ligada, pede `echoCancellation`, `noiseSuppression`, `autoGainControl` e `voiceIsolation`. Desligada: cru. Som da **tela** não passa por isso.
3. Teto automático da screenshare (`availableOutgoingBitrate` + kbps/fps): REMB continua fora; escada até ~30 fps se o upload for fraco.
4. ICE: fora do lab, ignora `127.0.0.1` / `::1`. ICE restart **só daquela live** (já no `protocol.js`). Sem `forceRelay` global.

### B — Sidecar e rede — feito

5. `load`+`save` do `registry.json` **atômicos** (`mutate_registry` / `save_unlocked` com tmp+replace).
6. `/beacon`, `/presence`, `/net-event`: exigem nick + senha da sala (sala aberta = só nick). GET `/must-change` sempre `{must_change: false}`; o POST com senha certa é que responde o flag.
7. Checklist Debian (ops, não chute no JS): timeout WS do NPM ≥ 3600 s; UDP 1194 + 50000–50100; Galene anuncia IP público, não Docker/`127.x`.

### C — Sessão, cache, painel — feito

8. Senha do admin **só em `sessionStorage`**. `localStorage.spartanAdminHandoff` é apagado. Prefs de qualidade em `localStorage.spartanPrefs` sem senha.
9. `postMessage` shell↔iframe com `location.origin`, não `*`.
10. Mapa de `?v=` alinhado (home prefetch = sala).
11. Painel canónico `/admin/`. `painel.html` e `/painel/` redirecionam.
12. Filtro de blur saiu da UI (`#filterform` hidden).

### D — Código e testes — feito

13. Módulos: `spartan-quality.js`, `spartan-net.js`, `spartan-watch.js`. `resizePeers` / grid ficaram no `galene.js`. `protocol.js` do Galene fica.
14. Testes: presença 5 min; HUD só-up; `voiceIsolation`; lock do registry; `test_reform_spartan`.
15. Leftovers do upstream (`stats.html`, `example/`, `painel.js`) **não** foram apagados — rotas antigas não quebram (`/painel/` redireciona).

### E — O que este plano **não** fez

RNNoise/Krisp; religar REMB; `forceRelay` para todos; reescrever o grid; cortar `getStats`/AudioContext das bolinhas; gravar a sala; PWA.

Cache **atual:** `galene.js?v=129`, `protocol.js?v=5`, `spartan-quality.js?v=1`.

---

## 17. Créditos

- **Galene** by [Juliusz Chroboczek](https://www.irif.fr/~jch/) — <https://galene.org>
- Interface Spartan — [wilbresley](https://github.com/wilbresley)
