# Conversas com a IA

Histórico de chats Cursor/IA sobre o **Galene Spartan**, em Markdown legível (pedido → resposta).

**Só neste repositório privado** (`galene-edicao-spartan`). Não copiar para o pacote público *the-gratis*.

Não contém senhas de produção. Ainda assim: decisões de deploy, estrutura do projeto — não publique.

## Arquivos

| Arquivo | Sobre |
|---|---|
| `2026-09-08-presenca-reconexao-fps-tela.md` | Presença/timers, reconexão 60s, botões live, FPS/bitrate (REMB), contador branco, sync do privado, hash de senhas |
| `_export-esta-conversa.js` | Regenera o Markdown a partir do transcript Cursor |

Exports brutos / JSONL (outra pasta): ver `docs/exports/`.

## Como usar noutro chat

1. Abra o workspace `S:\workspace\galene-edicao-spartan`.
2. Anexe o `.md` desta pasta (ou o trecho do tema).
3. Peça para continuar o Galene Spartan sem apagar grid/lives/mic sem ordem explícita.

## Regenerar

```bash
node docs/conversas-ia/_export-esta-conversa.js
```
