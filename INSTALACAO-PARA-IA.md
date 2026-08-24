# Instalação guiada por IA — leia isto primeiro

Este arquivo é para uma **IA** (Cursor, ChatGPT, etc.) ajudar uma pessoa **não técnica** a subir o Galene + Spartan.

**Como a IA deve se comportar**

1. Ler este arquivo inteiro antes de editar qualquer coisa.
2. Fazer as perguntas da seção **Questionário** — **uma de cada vez** (ou em blocos curtos), em português simples.
3. Não inventar domínio, IP ou senha: usar só o que a pessoa responder.
4. Preencher/gerar os arquivos listados em **O que a IA deve produzir**.
5. No final, entregar **só comandos prontos para colar** no terminal (Debian/Linux), sem jargão.
6. Nunca pedir para commitar senhas no Git. Nunca colar senhas em issues públicas.

---

## Resposta rápida: “só o Nginx resolve?”

| Situação | Precisa preencher tudo? |
|---|---|
| Testar no PC/servidor na rede local (`http://IP:8443`) | Quase não. Sobe com senha de fábrica e IP. Nginx pode vir depois. |
| Usar na internet com domínio HTTPS (como produção) | **Sim, precisa** de domínio + IP público (TURN) + proxy (Nginx/NPM) + portas. Só redirecionar HTTP **não** basta para vídeo/áudio estáveis. |

**Ordem recomendada (idiota-friendly):**

1. Subir os containers no Linux.  
2. Entrar local com `admin` / senha combinada.  
3. Depois apontar o Nginx/NPM para a porta **8443** (com WebSocket).  
4. Ajustar `proxyURL` / `canonicalHost` / `.env` (TURN) e reiniciar.  
5. Abrir portas do TURN/RTP no firewall/roteador.

Nginx = “porta da frente com cadeado HTTPS”.  
TURN/portas = “caminho do áudio/vídeo”. Sem isso, a sala abre mas a call falha fora de casa.

---

## Questionário (a IA pergunta; a pessoa responde)

### A) Onde vai rodar?

1. É um **VPS/servidor Linux** (Debian/Ubuntu) ou outro?  
2. Você tem **Docker** e `docker compose` já instalados? (sim/não)

### B) Rede e domínio

3. Qual o **IP público** do servidor? (o da internet; não o Wi‑Fi tipo 192.168.x.x)  
4. Qual o **IP da LAN** do servidor? (ex.: 192.168.100.16) — usado no Nginx Proxy Manager  
5. Vai usar **domínio** agora?  
   - Se sim: qual? (ex.: `chat.seudominio.com`)  
   - Se não: vamos usar só IP por enquanto (`http://IP:8443`)

### C) Proxy

6. Já tem **Nginx Proxy Manager**, Caddy ou Nginx?  
7. Se NPM: consegue criar um Proxy Host apontando para `http://IP_LAN:8443` com **WebSocket ligado**?

### D) Sala

8. Nome da sala na URL (minúsculo, sem espaço)? Padrão: `spartan`  
9. Título bonito da sala? (ex.: `Spartan`)  
10. Sala inicial: **sempre convite** (nick + senha de amigos). **Não** oferecer pública no instalador — confunde login/admin. Pública só depois, no painel.

### E) Contas (a pessoa escolhe; a IA não inventa)

11. Usuário admin? Padrão: `admin`  
12. Senha do admin? (mín. 8; **não** usar `Mudar@123` em produção)  
13. Se sala convite: senha dos **convidados/amigos**? (outra senha, mín. 8)

### F) Opcional

14. Fuso horário? Padrão: `America/Sao_Paulo`  
15. Quer liberar gravações em disco? (sim/não; padrão não)

Se a pessoa não souber IP público, a IA pode sugerir no servidor: `curl -4 ifconfig.me`

---

## O que a IA deve produzir (arquivos)

Na pasta do projeto (clone do repo):

| Arquivo | Conteúdo |
|---|---|
| `.env` | `TURN_PUBLIC_IP=<IP público da pergunta 3>` |
| `data/sidecar.auth` | uma linha `admin:SENHA_ADMIN` (chmod 600) |
| `data/config.json` | `proxyURL`, `canonicalHost`, user admin com **hash** da senha, `writableGroups: true` |
| `data/site.json` | `main` e `home` = id da sala |
| `groups/<sala>.json` | sala com user `op` + wildcard (convite com hash da senha de amigos, ou pública com `"type":"wildcard"`) |
| `static/sounds/` | `entrar.mp3`, `sair.mp3`, `mensagem.mp3` — avisos da sala; vão no clone |
| `data/accounts.json` | se o pacote usar IDs (Spartan): admin id 0; `must_change` false se senhas já finais |
| `data/registry.json` | `{}` ou estrutura vazia do pacote |

**Hashes:** seguir `data/README.md` do repo (pbkdf2/bcrypt). A IA gera o comando e pede para a pessoa colar o JSON do hash nos arquivos — **não** deixar senha em claro nos JSON das salas.

Se o pacote tiver `./scripts/subir.sh` (repo *the-gratis*):  
- pode usar fábrica `Mudar@123` para o **primeiro** sobe;  
- depois trocar senhas no modal / painel;  
- ainda assim preencher `.env` + domínio no `config.json` quando for expor na internet.

---

## Comandos finais que a IA deve entregar (exemplo)

Ajustar caminhos/nomes conforme as respostas:

```bash
cd ~/galene-edicao-spartan-the-gratis   # ou o path do clone
# (arquivos já preenchidos pela IA)
chmod 600 data/sidecar.auth
docker load -i images/galene-local.tgz
docker compose up -d
docker compose ps
```

Abrir:

- Local: `http://IP_LAN:8443/group/<sala>/`  
- Depois do proxy: `https://DOMINIO/group/<sala>/`  
- Admin: `https://DOMINIO/admin/`

Reinício depois de mudar config:

```bash
docker compose restart
# se mudou só registry.py:
docker restart spartan-reg
```

---

## Checklist “está igual eu uso agora” (zerado, mas usável)

- [ ] Containers `galene` e `spartan-reg` up  
- [ ] Entra na sala com admin  
- [ ] Painel `/admin/` abre com a mesma conta  
- [ ] Domínio HTTPS no proxy (se for o caso)  
- [ ] WebSocket no proxy  
- [ ] `.env` com IP **público** no TURN  
- [ ] Portas **1194** tcp/udp e **50000–50100** udp liberadas (internet)  
- [ ] `proxyURL` / `canonicalHost` batem com o domínio  

Usuários antigos **não** voltam sem backup zip da pasta `data/` + `groups/`. Instalação zerada = sala limpa, app configurado.

---

## Diferença entre os dois repos (para a IA explicar se perguntarem)

| | **Privado** `galene-edicao-spartan` | **Público** `…-the-gratis` |
|---|---|---|
| Senhas de produção | Não (gitignore) | Não |
| Código / UI / imagem | Sim | Sim (pacote “pronto”) |
| Um comando `./scripts/subir.sh` | Em geral não (fluxo manual/docs) | Sim |
| Para o dono desenvolver | Sim | Espelho público |
| Para qualquer um clonar | Não | Sim |

Funcionalmente, um **sobe do zero** parece: os dois precisam dos mesmos dados de rede/conta. O *gratis* só facilita o primeiro `docker up`. O **igualzinho de antes** (usuários, senhas atuais) só com **backup zip** da pasta do servidor — não com Git.
