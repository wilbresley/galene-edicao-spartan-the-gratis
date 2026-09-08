"use strict";
const fs = require("fs");
const path = require("path");

const SRC =
  "C:/Users/wilian.bresley/.cursor/projects/s-workspace-galene-castro/agent-transcripts/8dd7e8d2-81af-4f62-a688-57714c6c8649/8dd7e8d2-81af-4f62-a688-57714c6c8649.jsonl";
const OUT_DIR = path.join(__dirname);
const STAMP = "2026-09-08";
const OUT_MD = path.join(OUT_DIR, `${STAMP}-presenca-reconexao-fps-tela.md`);

const SECRET =
  /(sidecar\.auth\s*[:=]\s*\S+|(?:password|senha|credential|secret|token)["']?\s*[:=]\s*["'][^"']{6,}["']|Mudar@123)/gi;

function redact(s) {
  return String(s)
    .replace(SECRET, "[redacted]")
    .replace(/45\.4\.107\.171/g, "[IP_PUBLICO]")
    .replace(/192\.168\.100\.16/g, "[IP_LAN]");
}

function stripUserQuery(text) {
  let t = String(text);
  t = t.replace(/<timestamp>[\s\S]*?<\/timestamp>\s*/g, "");
  t = t.replace(/<\/?user_query>/g, "");
  t = t.replace(/<\/?agent_transcript[^>]*>[\s\S]*$/g, "");
  return t.trim();
}

function extractText(content) {
  if (content == null) return { text: "", tools: [] };
  const texts = [];
  const tools = [];
  const chunks = Array.isArray(content) ? content : [content];
  for (const c of chunks) {
    if (typeof c === "string") {
      texts.push(c);
      continue;
    }
    if (!c || typeof c !== "object") continue;
    if (c.type === "tool_use") tools.push(c.name || "tool");
    else if (c.type === "text" || c.type == null) texts.push(c.text || "");
  }
  return { text: texts.join("\n").trim(), tools };
}

const raw = fs.readFileSync(SRC, "utf8");
const turns = [];

for (const line of raw.split(/\r?\n/)) {
  if (!line.trim()) continue;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    continue;
  }
  if (obj.type === "turn_ended") continue;
  const role = obj.role || "";
  if (role !== "user" && role !== "assistant") continue;
  const msg = obj.message || obj;
  const { text, tools } = extractText(msg.content);
  let body = redact(text);
  if (role === "user") body = stripUserQuery(body);
  // pula lixo de sistema / agent transcripts embutidos
  if (/agent_transcripts|You are an AI coding assistant|<\/communication>/i.test(body)) {
    continue;
  }
  // remove blocos só de [REDACTED] (thinking/tools do Cursor)
  body = body
    .replace(/^\s*\[REDACTED\]\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!body) continue;
  // junta assistants consecutivos (texto depois de tools)
  if (
    role === "assistant" &&
    turns.length &&
    turns[turns.length - 1].role === "assistant"
  ) {
    const last = turns[turns.length - 1];
    last.body = (last.body ? last.body + "\n\n" : "") + body;
    last.tools.push(...tools);
    continue;
  }
  turns.push({ role, body, tools: [...tools] });
}

const parts = [];
parts.push("# Conversa com a IA — Galene Spartan\n\n");
parts.push(`**Data do export:** ${STAMP}\n`);
parts.push("**Workspace:** `galene-castro` (espelho público) → sync no privado `galene-edicao-spartan`\n");
parts.push("**Branch:** `main`\n");
parts.push(
  "**Temas:** presença/timers, reconexão 60s, botões Câmera/Tela, FPS/bitrate da tela (REMB), contador branco, sync do repo privado, hash de senhas, export de conversa\n\n"
);
parts.push(
  "> Formato: o que o usuário pediu e o que a IA respondeu sobre o projeto. Chamadas de ferramenta omitidas (só o diálogo útil).\n\n"
);
parts.push("---\n");

let n = 0;
for (const t of turns) {
  if (!t.body || !t.body.trim()) continue;
  // respostas só com “vou checar…” muito curtas sem substância: mantém se tiver conteúdo
  let body = t.body.trim();
  if (body.length > 15000) {
    body = body.slice(0, 15000) + "\n\n…[cortado no export]…";
  }
  n += 1;
  if (t.role === "user") {
    parts.push(`\n## Usuário\n\n${body}\n`);
  } else {
    parts.push(`\n## IA\n\n${body}\n`);
  }
}

parts.push("\n---\n\n");
parts.push("## Notas para outra IA\n\n");
parts.push(
  "- Repo privado: `https://github.com/wilbresley/galene-edicao-spartan` — exports só aqui.\n"
);
parts.push(
  "- Não commitar `data/` vivo, `sidecar.auth`, `groups/spartan.json` de produção.\n"
);
parts.push(
  "- Cache atual da sala: `galene.js?v=115`, `galene-spartan.css?v=99`.\n"
);
parts.push(
  "- Senhas de usuário: hash PBKDF2 (não criptografia reversível). `sidecar.auth` é texto no servidor.\n"
);

fs.writeFileSync(OUT_MD, parts.join(""), "utf8");
console.log(`turns_kept≈${n} file=${OUT_MD} bytes=${fs.statSync(OUT_MD).size}`);
