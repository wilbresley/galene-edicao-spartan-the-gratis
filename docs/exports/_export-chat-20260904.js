"use strict";
const fs = require("fs");
const path = require("path");

const SRC =
  "C:/Users/wilian.bresley/.cursor/projects/s-workspace-galene-castro/agent-transcripts/8dd7e8d2-81af-4f62-a688-57714c6c8649/8dd7e8d2-81af-4f62-a688-57714c6c8649.jsonl";
const dir = __dirname;
const STAMP = "20260904";
const OUT_MD = path.join(dir, `conversa-spartan-${STAMP}.md`);
const OUT_RAW = path.join(dir, `conversa-spartan-${STAMP}.jsonl`);
const OUT_RAW_LATEST = path.join(dir, "conversa-spartan-raw.jsonl");

const SECRET =
  /(sidecar\.auth\s*[:=]\s*\S+|(?:password|senha|credential|secret|token)["']?\s*[:=]\s*["'][^"']{6,}["']|Mudar@123)/gi;

function redact(s) {
  return String(s)
    .replace(SECRET, "[redacted]")
    .replace(/45\.4\.107\.171/g, "[IP_PUBLICO]")
    .replace(/192\.168\.100\.16/g, "[IP_LAN]");
}

const raw = fs.readFileSync(SRC, "utf8");
fs.writeFileSync(OUT_RAW, raw, "utf8");
fs.writeFileSync(OUT_RAW_LATEST, raw, "utf8");

const parts = [
  "# Export da conversa Cursor — Galene/Spartan\n",
  `\nGerado em: 2026-09-04\n`,
  "Fonte: agent-transcripts/8dd7e8d2-81af-4f62-a688-57714c6c8649\n",
  "Workspace desta conversa: `S:\\workspace\\galene-castro` (espelho público the-gratis).\n",
  "\nComo importar noutro chat: leia `COMO-IMPORTAR.md` e `RESUMO-CONVERSA-20260904.md`.\n",
  "\nTexto dos pedidos e respostas. Chamadas de ferramenta aparecem só como `[tool: nome]`.\n",
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
  let body = redact(texts.join("\n")).trim();
  // corta blocos gigantes de tool/plan anexado
  if (body.length > 12000) body = body.slice(0, 12000) + "\n\n…[cortado para caber no export]…\n";
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
