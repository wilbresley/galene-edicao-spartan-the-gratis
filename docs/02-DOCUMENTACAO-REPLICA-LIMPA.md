# Galene + interface Spartan — guia limpo para replicar

Este texto **não contém** domínio, IP, senha, nick de operador nem dado pessoal da implantação original. Serve para um amigo montar o **mesmo tipo de stack** com as coisas dele.

Software de base: **[Galene](https://galene.org)** (Juliusz Chroboczek). A “Spartan” é só o estático (HTML/CSS/JS) e um sidecar Python na frente.

O pacote deste repositório já traz `Dockerfile`, `compose.yaml`, `registry.py` e `static/`. Copie os `*.example.json`, preencha com **as contas dele** e suba.

---

## O que você precisa

- Debian (ou similar) com Docker + Compose
- Um proxy HTTPS na frente (Nginx Proxy Manager, Caddy, Traefik…) com WebSocket
- IP público **ou** pelo menos portas UDP/TCP de TURN encaminhadas do roteador para o servidor
- Um domínio com certificado (Let’s Encrypt / Cloudflare)

Sem TURN acessível da internet, celular em 4G **não** fecha vídeo. STUN sozinho não basta.

---

## Portas

| Porta | Protocolo | Uso |
|---|---|---|
| **443** | TCP | HTTPS no proxy (único que o usuário vê) |
| **8443** | TCP | Galene HTTP interno (`-insecure`); o proxy aponta para cá |
| **8091** | TCP | Sidecar da interface (API `/spartan-api/`) |
| **1194** | TCP **e** UDP | TURN nativo do Galene |
| **50000–50100** | UDP | Faixa RTP |

No roteador: encaminhar **1194 TCP+UDP** e **50000–50100 UDP** para o IP LAN do servidor. O 8443/8091 podem ficar só na LAN se o proxy roda na mesma máquina.

---

## Ideia da arquitetura

```
Cliente  --HTTPS-->  Proxy (SEU_DOMINIO)
                      ├── /              → 127.0.0.1:8443   Galene
                      └── /spartan-api/  → 127.0.0.1:8091   sidecar
```

Containers com **`network_mode: host`** para o TURN anunciar o **IP público** certo.

Galene: `-http :8443 -insecure`. TLS só no proxy.  
`canonicalHost` / `proxyURL`: `https://SEU_DOMINIO/`

---

## Primeira sala e config

Siga o `README.md` na raiz e `data/README.md`. Em resumo:

- `.env` com `TURN_PUBLIC_IP`
- `data/config.json` com operador **hasheado** e `writableGroups: true`
- `groups/sala-principal.json` (ou o slug que escolher) com wildcard pública **ou** senha de amigos hasheada
- `data/site.json` com `main` e `home`
- `data/sidecar.auth` (`usuario:senha`, chmod 600) — **não versionar**

Não delete o campo password do wildcard: o Galene recusa entrada.

---

## Proxy

- Host `SEU_DOMINIO` → `http://IP_LAN:8443`, **WebSocket on**
- Location `/spartan-api/` → `http://IP_LAN:8091`

---

## Comportamento da interface

- Home: botão lê `/spartan-api/site` + `/public-groups.json`
- `/salas/`: busca, A–Z ou Recentes, no máximo 5 linhas visíveis (altura fixa)
- `/admin/`: painel (não use `/admin.html` na URL)
- Sala `/group/<id>/`: login no estilo da home; sala pública esconde senha
- Rodapé: crédito **Galene / Juliusz** (obrigatório)
- Temporários = só salas sem senha; convites = senha de amigos
- Sair limpa sessão; Voltar à sala no admin **não** desloga
- Purge das públicas na hora cheia (`America/Sao_Paulo` no `registry.py`)
- `BAN_IP` no Python: ligue só quando quiser suspender IP 24h após o purge

---

## Segurança

1. Gere senhas **novas**. Nunca reutilize as de outro servidor.
2. Hash com a ferramenta do Galene (`galene -help` na imagem compilada).
3. Não publique `sidecar.auth`, `registry.json` com dados de gente, nem backup `.plain-bak`.
4. Não escreva nomes de operadores na tela de login do admin.

---

## Créditos (mantenha no rodapé)

- Galene by [Juliusz Chroboczek](https://www.irif.fr/~jch/) — https://galene.org
- A interface visual pode ser a tua; não apague a atribuição do Galene.
