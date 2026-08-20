# Galene — edição Spartan

Videoconferência auto-hospedada com **[Galene](https://galene.org)** (Juliusz Chroboczek) e interface **Spartan** (HTML/CSS/JS + sidecar Python).

Repositório **privado** de [wilbresley](https://github.com/wilbresley). Não contém senhas, `sidecar.auth`, `registry.json` nem JSON de salas com contas reais.

## O que tem aqui

| Caminho | Função |
|---|---|
| `Dockerfile` | Compila o Galene atual a partir do Git oficial |
| `compose.yaml` | Galene (`:8443`) + sidecar `spartan-reg` (`:8091`), `network_mode: host` |
| `registry.py` | API `/spartan-api/` (salas, convites, beacon, purge) |
| `static/` | Home, `/salas/`, `/admin/`, sala, wallpaper, CSS/JS |
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
docker compose up -d --build
```

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
- [Guia limpo para replicar](docs/02-DOCUMENTACAO-REPLICA-LIMPA.md) — placeholders, para um amigo
- [Backup ZIP no servidor](docs/03-COMANDO-BACKUP.md)
- [Como gerar hashes / sidecar.auth](data/README.md)

O zip de backup **privado** do Debian (`~/galene-backup-*.zip`) **não** entra neste repositório: ele tem `sidecar.auth` e hashes reais.

## Créditos

- **Galene** by [Juliusz Chroboczek](https://www.irif.fr/~jch/) — <https://galene.org>
- Interface Spartan — [wilbresley](https://github.com/wilbresley)

Terceiros em `static/third-party/` (Font Awesome, Toastify, Contextual) conservam a licença original de cada pasta.
