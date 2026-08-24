"use strict";
const fs = require("fs");
const path = require("path");

const SRC =
  "C:/Users/wilian.bresley/.cursor/projects/s-workspace-smart-castro-app/agent-transcripts/9c35dbb1-0ff3-4dd3-ad70-d720a2b8e206/9c35dbb1-0ff3-4dd3-ad70-d720a2b8e206.jsonl";
const dir = __dirname;
const OUT_MD = path.join(dir, "conversa-spartan-20260824.md");
const OUT_RAW = path.join(dir, "conversa-spartan-raw.jsonl");

const SECRET =
  /(sidecar\.auth\s*[:=]\s*\S+|(?:password|credential|secret|token)["']?\s*[:=]\s*["'][^"']{8,}["'])/gi;

function redact(s) {
  return String(s).replace(SECRET, "[redacted]");
}

const raw = fs.readFileSync(SRC, "utf8");
fs.writeFileSync(OUT_RAW, raw, "utf8");

const parts = [
  "# Export da conversa Cursor — Galene/Spartan\n",
  "\nGerado em: 2026-08-24 (noite)\n",
  "Fonte: agent-transcripts/9c35dbb1-0ff3-4dd3-ad70-d720a2b8e206\n",
  "\nTexto dos pedidos e respostas. Chamadas de ferramenta aparecem só como `[tool: nome]`. Sem senhas de produção.\n",
];

let n = 0;
for (const line of raw.split(/\r?\n/)) {
  if (!line.trim()) continue;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    continue;
  }
  const role = obj.role || obj.type || "";
  const msg = obj.message || obj;
  const content = msg && msg.content;
  if (content == null) continue;
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
    else if (c.type == null || c.type === "text") texts.push(c.text || "");
  }
  const body = redact(texts.join("\n")).trim();
  if (!body && !tools.length) continue;
  n += 1;
  const label = role === "user" || role === "human" ? "user" : "assistant";
  parts.push(`\n## ${label} (${n})\n\n`);
  if (body) parts.push(body + "\n");
  for (const tn of tools) parts.push(`[tool: ${tn}]\n`);
}

fs.writeFileSync(OUT_MD, parts.join(""), "utf8");
console.log(
  `messages=${n} md=${fs.statSync(OUT_MD).size} raw=${fs.statSync(OUT_RAW).size}`
);
