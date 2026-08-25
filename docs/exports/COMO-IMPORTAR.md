# Como importar esta conversa noutro chat / IA

Estes arquivos estão **só no repositório privado** (`galene-edicao-spartan`). Não vão para o GitHub público.

Não contém senhas de produção do servidor. Ainda assim: é histórico de desenvolvimento (IPs, domínio, decisões). Não publique.

## Qual arquivo usar

| Arquivo | Para quê |
|---|---|
| `RESUMO-CONVERSA-20260825.md` | Começar rápido: regras, repos, o que foi corrigido |
| `conversa-spartan-20260825.md` | Pedidos e respostas desta conversa (tools só pelo nome) |
| `conversa-spartan-20260825.jsonl` | Transcript bruto do Cursor (melhor fidelidade) |
| `conversa-spartan-raw.jsonl` | Cópia “latest” do mesmo JSONL |
| `conversa-spartan-20260824.md` | Recorte do dia anterior |

## No Cursor (chat novo)

1. Abra um chat novo no workspace do **Galene** (`S:\workspace\galene-edicao-spartan`), não no Castro.
2. Anexe `RESUMO-CONVERSA-20260825.md` **e** `conversa-spartan-20260825.md` (ou o `.jsonl` se a IA aceitar).
3. Peça: *“Leia os anexos. Continue o trabalho do Galene Spartan. Não mexa no Castro. Não apague grid/lives/mic sem eu mandar.”*

Se o markdown for grande demais para o anexo, use só o **resumo** + os trechos que importam, ou corte o `.md` em partes.

## Noutra IA (ChatGPT, Claude, etc.)

1. Envie primeiro o resumo.
2. Se precisar do detalhe (uma treta específica), cole o trecho correspondente do `.md` (busque pelo tema: login, grid, câmera, push, Nginx…).
3. Não cole o JSONL inteiro se a janela de contexto for pequena — ele é o arquivo mais pesado.

## Regenerar o export

No Windows, na pasta do repo privado:

```bash
node docs/exports/_export-chat.js
```

O script lê o transcript Cursor desta conversa e regrava o `.md` + `.jsonl`.
