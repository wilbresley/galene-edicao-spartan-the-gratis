# Spartan Chat (Galene) — documentação completa da implantação

**Data da implantação:** 20 de agosto de 2026  
**Última revisão deste documento:** 4 de setembro de 2026  
**Objetivo deste arquivo:** registrar *como o stack ficou no teu servidor*, para operação, backup e GitHub.  
**Segredos:** nenhuma senha de produção, hash real do servidor, `sidecar.auth` vivo ou credencial operacional aparece aqui. Contas e senhas **da instalação** ficam só no servidor (`groups/*.json`, `data/config.json`, `data/sidecar.auth`).  
**Exceção documentada:** o pacote `factory-reset/` traz a senha de fábrica `Mudar@123` (admin + convidados) de propósito — só para zerar o Docker; no primeiro login o admin **obrigatoriamente** troca as duas.

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

Imagem do Galene: **`galene:local`**, a mesma salva no Debian (`docker save`, 20/08/2026), no repo em `images/galene-local.tgz`. O `compose.yaml` **não** faz `build`: carrega essa imagem com `docker load`. Fonte pinado em `vendor/galene` (commit `9e03b36ba93f05e88fcfd6c3ea5468c16bcbae32`) só entra se alguém recompilar de propósito.

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
      accounts.json        (cofre único: ID, nick, hash de senha, cargo)
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

### 9.2 Cargos na sala (3 só)

| Cargo (UI) | Valor Galene | Quem nasce assim | Pode |
|---|---|---|---|
| **Admin** | `op` | conta admin | moderar + tudo |
| **Verificado** | `present` (string → present+message) | **convidado** (sala convite / senha de amigos) | lives, transmitir, chat texto e voz |
| **Ouvinte** | `["present"]` (present **sem** message) | **temporário** (sala pública) | só voz (falar/ouvir); **sem** lives, **sem** chat texto, **sem** transmitir vídeo/tela |

- Tipo de entrada (cadastrado / convidado / temporário) ≠ cargo. Nos logs, “Admin (painel)” é só o evento de login no `/admin`, não um 4º cargo.
- **Cofre único (`data/accounts.json`):** nick, hash de senha e cargo (`op` / `present` / `ouvinte`) vivem aqui. Cadastrados entram em **qualquer** sala com a senha da conta; o sidecar sincroniza o user no Galene da sala destino no `/join-named` (adaptador interno). Senha de convite de amigos **não** entra no cofre — só vale naquela sala.
- Convidados que **não** pediram cadastro somem da lista do painel após **24 h** (`prune_stale_guests`, a cada ~20 s); o histórico fica em `access.log` (`convidado_expirado`).
- Sala pública: o sidecar (`ensure_open_ouvinte` no beacon) alinha o wildcard para Ouvinte.
- Sala convite: wildcard permanece Verificado (`present`).
- Painel: menu de cargo moderno; Renomear verde; Redefinir senha em modal; aba Logs com filtros (tipo, nick, IP).

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
| POST | `/beacon` | sala | IP + visto; em sala pública chama `ensure_open_ouvinte` |
| POST | `/register` `/approve` `/quick` `/deny` `/block` `/unblock` `/forget` `/stamp` | fluxos de convite | cadastro / moderação |
| POST | `/panel-login` | painel | admin: `sidecar.auth`, `config.json` ou conta **op** no cofre |
| POST | `/can-panel` | sala | igual ao panel-login, **sem** gravar log (mostra o botão Painel Admin **só** se a conta for admin cadastrado; anfitrião 24h = não) |
| POST | `/net-event` | sala (beacon) | cliente reporta queda/recuperação WS (código, duração, se recuperou) |
| POST | `/join-named` | sala | valida senha no **cofre** e sincroniza user+cargo na sala destino (anfitrião 24h continua só na sala dele) |
| POST | `/create-room` | admin | cria sala extra: `open` (pública = 24h) ou convite; `ttl` opcional no convite; anfitrião só se `ttl` |
| POST | `/first-setup` | admin | troca senha admin + amigos no 1º login |
| POST | `/rename-user` | admin | renomeia por ID imutável |
| POST | `/site-home` | admin | define sala da home |
| POST | `/rename-main` | admin | renomeia slug + título da main |
| * | `/gapi/*` | admin | proxy da API Galene (`/galene-api/v0/...`). Coleções (`.users/`, `.groups/`, `.tokens/`) ganham barra final aqui — sem isso o Galene responde `404 page not found` e o texto aparece embaixo do **Entrar** no painel. |

Salas **extra** de 24h: o sidecar apaga o JSON do grupo quando `expires_at` chega (a cada ~20 s). Quem está dentro vê à **direita do nome da sala** `Tempo até exclusão desta sala: HH:MM`. O relógio liga no boot da página (`temp-status` + `sessionStorage spartanTtl:<grupo>`), então **sobrevive a F5 / rejoin** — não depende do submit do login. A **main** não entra neste prazo. Públicas extra que já existiam sem prazo ganham 24h no próximo start do sidecar. Ban de IP 24h só se `BAN_IP = True` (desligado).

Beacon grava `seen[nick] = {first, last, ip}` para **todo mundo** (inclusive registrados), para o painel mostrar IP / sala / visto. IP prefere `CF-Connecting-IP` / hops úteis do XFF.

---

## 11. Interface Spartan (estáticos)

Volume `./static` por cima do static da imagem. Arquivos-chave:

- `index.html` + `custom-home.js` — **landing** em `/`. **Nunca** copiar o painel por cima de `index.html`. Login do painel: **`/admin`** — arquivo `static/admin` (não pasta).
- `salas/` — busca, ordenação, paginação (5 linhas de altura fixa)
- `admin/` — usuários, convidados, bloqueados, temporários, logs, **oscilações**, salas
- `galene.html` + `galene.js` + `galene-spartan.css` + `spartan-boot.js` — sala
- Wallpaper `papel-de-parede.jpg`
- Sons da sala `static/sounds/` — `entrar.mp3`, `sair.mp3`, `mensagem.mp3` (vão no Git; o instalador avisa se faltarem)
- Rodapé fixo: Galene / Juliusz (esquerda), “Interface refeita por wilbresley” (centro), Outras salas/Home (direita). Sem linha cinza; fundo semitransparente por cima da imagem.

Comportamentos de sessão:

- Login da sala **não** usa `autocomplete` de senha do Chrome. A tela da sala **só** aparece depois do Galene aceitar nick+senha (`joined`); senha errada fica no login, um toast, sem reconectar em loop.
- Sessão por sala em `sessionStorage` (`spartanSession:<grupo>`) — gravada **só** depois do join certo.
- **Sair** (sala ou painel) limpa tudo e marca `spartanLoggedOut`.
- **Voltar à sala** no painel: se a aba da call responder (`BroadcastChannel spartan-room`), foca-a e tenta fechar o admin; senão copia o login para `spartanSession:<sala>` e reentra já autenticado. **Não** abre a call na aba do painel se ela já existir.
- F5 na mesma sala reentra; ir para outra sala depois de Sair pede nick/senha.
- Contador 24h (`#spartan-ttl`) reconstitui no `start()` (não só no submit do login): `spartanTtlRestore` + `GET /temp-status`. Anfitrião/op também faz poll.
- CSP do Galene bloqueia JS inline: não usar `onfocus="..."` nos inputs.
- Admin SSO: handoff `localStorage` para abrir o painel já logado.
- Cache dos JS/CSS da sala: query `?v=` em `galene.html` (hoje `galene.js?v=112`, `galene-spartan.css?v=98`, `protocol.js?v=3`, `toastify.js?v=3`, `spartan-boot.js?v=9`). Home shell: `spartan-shell.js?v=4`, `spartan-shell.css?v=8`, `custom-home.js?v=4`, `salas.js?v=5`. Painel: `admin.js?v=38`, `admin.css?v=25`. **`registry.py`**: reiniciar `spartan-reg` após mudanças no sidecar.

Painel admin:

- Login com wallpaper + rodapé; depois do login a caixa some (`#login-box[hidden]`).
- Não divulgar nomes de operadores na tela de login.
- Temporários = só salas `open` (sem senha).
- Cadastrados: ID + nome à esquerda; à direita Detalhes, cargo e pares **Renomear / Redefinir senha** e **Excluir / Bloquear** (largura do texto + padding). **Detalhes** expande sala, IP e último visto.
- Senha dos amigos **só na aba Salas** (por sala). A aba Usuários não duplica isso.
- **Aba Salas:** barra fixa com **+ Criar sala** (modal); listas roláveis em três blocos — **principal**, **permanentes** (lista pública), **temporárias 24h** (só admin, contador + copiar link). Botão **Definir como entrada** = sala que abre na raiz do site; selo **Entrada do site** quando já é essa.
- Listas: A–Z (padrão) ou Recentes.
- Main no topo, sem Apagar; permanentes podem ser entrada do site.
- Cargos: Admin / Verificado / Ouvinte (sem “só chat”).
- Logs: filtros por tipo, nick e IP; horário Brasília.
- **Oscilações:** aba própria; `data/net.log` 30 dias; filtros nick/sala/IP; cada queda conta.
- **Criar sala (modal):** três tipos — convite definitiva, convite 24h, pública 24h; código aleatório automático nas 24h; bloco anfitrião só em convite 24h; após criar, **Copiar link** no modal.

---

## 12. Cliente da sala

- Erros do Galene traduzidos (ex.: `not authorised` → PT).
- Sala pública: campo senha oculto por defeito (`html.spartan-open-room`); botão **Entrar com conta cadastrada** / **Entrar como temporário** (`html.spartan-named-login`) fica **fora** do `.connect` para a caixa não rebentar. `.login-box` usa `height:auto`.
- Histórico de chat: mensagens com mais de **24 h** não entram na caixa (e as que já estavam saem). Guests/temps continuam sem histórico antigo; o corte `created` segue igual. Mensagem nova abre o chat (quem pode texto), salvo **Não abrir o chat automaticamente** (fica neste browser).
- “Solicitar registro” só para convite, não para pública.
- Sem kick HTTP nativo: o cliente sai sozinho no purge / bloqueio.
- Multi-live: botão **Tela** só no compartilhamento de tela; **Câmera** só com faixa de vídeo (mic sozinho = só a bolinha, sem texto Câmera). Cabeçalho preto acima do vídeo.
- **Fluência:** live **assistida** (clicada) pede sempre `['audio','video']` — nunca `video-low`, mesmo se tu estiveres a transmitir ou com o jogo aberto. Nos receivers dessas lives: `contentHint=detail` e `degradationPreference=maintain-resolution`. As outras pedem áudio só (sem imagem), salvo tela sem áudio (`video-low` só para não sumir o botão Tela). `contentHint` de tela que **envias** = `motion`.
- **Painel Admin** (botão na sala): depende **só** de `POST /can-panel` (conta cadastrada da main / sidecar). Não exige `op` da sala atual. Anfitrião 24h não vê o botão. Abre sempre em nova aba (`window.open` + handoff `spartanAdminHandoff`).
- **Uma** live na sala: já entra em foco; clique extra nela não faz nada. Duas lives: **lado a lado** já na primeira abertura (o foco automático da primeira não deixa o grid numa coluna só). Três ou quatro: grid 2×2. Clique escolhe o foco.
- **Minhas lives:** ícones de olho; verde = mostrando, vermelho = ocultando. O X nas lives dos outros esconde; o X na **própria** live **para** aquele share. Fechar a **câmera** (header ou X) com o mic ligado **mantém o microfone**; o ícone verde do mic acompanha o estado real.
- Engrenagem: rótulo **Configurações**. Painel só com o que a sala usa: perfil (trocar senha / admin), dispositivos (câmera, microfone, espelhar, ruído, áudio HQ) e **Sons da sala** (entrada, saída e mensagem, cada um à parte). As escolhas de som ficam em `localStorage` por nick neste browser. Fora do menu (fixo por baixo): envio **ilimitado**, duas qualidades **automático** (no Firefox, desligado), receber **tudo**, filtros desligados, modo quadro desligado, detectar atividade **sempre ligado** (é a mesma lógica da bolinha).
- **Sair** no cabeçalho (vermelho `#dc2626`), com confirmação.
- **Ouvinte** (`body.spartan-ouvinte`): microfone ok; sem lives, sem chat texto, sem câmera/tela.
- Lista de usuários: clique esquerdo (PC) abre o menu. No **celular**, o drawer da lista desliza da esquerda; o menu do usuário só com **segurar 1 s**, em `position:fixed` por cima do drawer (`z-index` alto). Soltar o dedo **não** fecha o menu (o clique sintético é ignorado ~900 ms).
- Menu do outro usuário: **Mudo** (só o teu fone), **Volume (seu fone)** 0–400% em passos de 5%, e se fores admin: apresentar / **Silenciar microfone** (muta o mic **dele** para toda a sala) / Expulsar. Sem Identificar (não manda IP) e sem enviar arquivo.
- Bolinha: **cinza** off; **amarelo** mic ligado parado; **verde** falando; **vermelho** mutado. Publish segue a **faixa** (`enabled`+`live` → `on`; senão `localMute` → `muted`) e reenvia o estado a cada ~2,5 s. Nos outros, `micstate === 'muted'` é absoluto (analisador/stats não pintam amarelo). Desmutar / falar com faixa viva publica `on` mesmo que o `localMute` da sessão tenha ficado preso.
- Sons da sala (`static/sounds/`): `entrar.mp3`, `sair.mp3`, `mensagem.mp3`. Toca para os **outros** (não para ti, não no histórico, não no lote dos 1,5 s ao entrares). Configurações: três interruptores (entrada / saída / mensagem), ligados por defeito, gravados neste computador por nick. O browser só liberta o áudio depois do primeiro clique/tecla.
- Queda da ligação, depois que você já entrou: **graça de 60 s** (corte único).
  - **&lt; 60 s:** reconecta em silêncio (sem overlay), **não** força mute e republica mic/câmera/tela no mesmo estado (`hadCamera` = vídeo real; `hadMicOnly` = só áudio; nunca promove mic-só a câmera). Flag `_spartanRecoveringMedia`. O Galene larga o peer no servidor — os outros podem ver um piscar; no teu PC a mídia local fica.
  - **≥ 60 s:** fecha ups locais (`closeUpMedia`), limpa o snapshot, mostra overlay **Ligação perdida** e trata como queda. Ao voltar depois disso, entra “limpo” (mic desligado; precisa religar tela/câmera).
  - Tentativas: silencioso ~1,5 s na graça; depois do overlay, 2 s / ~2,5 s e evento `online`. **Sair**, `/leave` e kick não entram nesta graça. Cada blip/recuperação/queda → `POST /net-event`.
- Botão **Câmera**/**Tela** sob o nick: só com vídeo/tela reais (`streamHasRealVideo` / `screenshare`). Mic sozinho = bolinha; sem atalho `camlive` para inventar botão Câmera.
- Header da sala permanente: timer branco `HH:MM:SS` = **tempo da sala** (servidor). Conta só com gente online; sala vazia > **60 s** zera. Menu do nick: **tempo individual** na sala (também do servidor). `pagehide` avisa saída para o registry.
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
- Histórico desta conversa Cursor (privado): `docs/exports/` — markdown + JSONL para importar noutro chat.

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
26. 01/09/2026: **shell SPA** na home (`/#/`, `/#/salas`, `/#/group/<id>`); painel admin em overlay; modo jogo, tela 720p/1080p, 60 fps na captura, HUD FPS/bitrate, VP8 primeiro. Cache: `galene.js?v=95`, `galene-spartan.css?v=75`, `spartan-shell.js?v=1`, `admin.js?v=34`.
27. 01/09/2026: lista de salas sem 24h; slug aleatório 15 chars nas temporárias; login persiste entre salas; config compacta; FPS/bitrate via stats Galene. Cache: `galene.js?v=98`, `protocol.js?v=3`, `salas.js?v=5`, `admin.js?v=36`. Reiniciar `spartan-reg` após `registry.py`.
28. 04/09/2026: **presença no servidor** — header = tempo da sala (`HH:MM:SS`, branco); menu do nick = tempo individual; sala vazia > 60 s zera o timer da sala; `POST /presence`, `GET /presence-room` / `presence-user`; lista de salas com online + live. **Reconexão** graça 60 s (preserva mic/live). Shell SPA centralizado; sem flash de login ao trocar sala. Cache: `galene.js?v=110`, `galene-spartan.css?v=98`, `spartan-boot.js?v=9`, `spartan-salas.js?v=4`, `spartan-shell.css?v=8`. Reiniciar `spartan-reg`.
29. 04/09/2026: botão **Câmera**/**Tela** sob o nick só com vídeo/tela reais (mic = bolinha; sem atalho `camlive`). Reconexão: **&lt; 60 s** preserva mic/tela/câmera sem mute forçado (`_spartanRecoveringMedia`, `hadMicOnly`); **≥ 60 s** fecha mídia e overlay. Cache: `galene.js?v=112`.

---

## 16. Créditos

- **Galene** by [Juliusz Chroboczek](https://www.irif.fr/~jch/) — <https://galene.org>
- Interface Spartan — [wilbresley](https://github.com/wilbresley)
