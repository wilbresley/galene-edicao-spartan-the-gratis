"use strict";
const fs = require("fs");
const path = require("path");

const SRC =
  "C:/Users/wilian.bresley/.cursor/projects/s-workspace-smart-castro-app/agent-transcripts/9c35dbb1-0ff3-4dd3-ad70-d720a2b8e206/9c35dbb1-0ff3-4dd3-ad70-d720a2b8e206.jsonl";
const OUT = "S:/Downloads/Conversa com Cursor.txt";

const SECRET =
  /(sidecar\.auth\s*[:=]\s*\S+|(?:password|credential|secret|token)["']?\s*[:=]\s*["'][^"']{8,}["'])/gi;

function redact(s) {
  return String(s).replace(SECRET, "[redacted]");
}

function cleanUser(text) {
  let t = String(text);
  const ts = t.match(/<timestamp>([\s\S]*?)<\/timestamp>/);
  const stamp = ts ? ts[1].trim() : "";
  t = t.replace(/<timestamp>[\s\S]*?<\/timestamp>\s*/g, "");
  t = t.replace(/<user_query>\s*/g, "").replace(/\s*<\/user_query>/g, "");
  t = t.replace(/<user_info>[\s\S]*?<\/user_info>\s*/g, "");
  t = t.replace(/<git_status>[\s\S]*?<\/git_status>\s*/g, "");
  t = t.replace(/<agent_transcripts>[\s\S]*?<\/agent_transcripts>\s*/g, "");
  t = t.replace(/<agent_skills>[\s\S]*?<\/agent_skills>\s*/g, "");
  t = t.replace(/<always_applied_workspace_rules>[\s\S]*?<\/always_applied_workspace_rules>\s*/g, "");
  t = t.replace(/<user_rules>[\s\S]*?<\/user_rules>\s*/g, "");
  t = t.replace(/<communication>[\s\S]*?<\/communication>\s*/g, "");
  t = t.replace(/<citing_code>[\s\S]*?<\/citing_code>\s*/g, "");
  t = t.replace(/<terminal_files_information>[\s\S]*?<\/terminal_files_information>\s*/g, "");
  t = t.replace(/<browser_verification>[\s\S]*?<\/browser_verification>\s*/g, "");
  t = t.replace(/<dynamic_tools>[\s\S]*?<\/dynamic_tools>\s*/g, "");
  t = t.replace(/<open_and_recently_viewed_files>[\s\S]*?<\/open_and_recently_viewed_files>\s*/g, "");
  t = t.replace(/<system_reminder>[\s\S]*?<\/system_reminder>\s*/g, "");
  t = t.replace(/<attached_files>[\s\S]*?<\/attached_files>\s*/g, "");
  t = t.trim();
  return { stamp, text: t };
}

function extractTexts(content) {
  const texts = [];
  const chunks = Array.isArray(content) ? content : [content];
  for (const c of chunks) {
    if (typeof c === "string") {
      texts.push(c);
      continue;
    }
    if (!c || typeof c !== "object") continue;
    if (c.type === "text" && c.text) texts.push(c.text);
    else if (c.type == null && c.text) texts.push(c.text);
  }
  return texts.join("\n").trim();
}

if (!fs.existsSync("S:/Downloads")) {
  fs.mkdirSync("S:/Downloads", { recursive: true });
}

const raw = fs.readFileSync(SRC, "utf8");
const lines = [];
let nUser = 0;
let nAsst = 0;
let lastRole = "";
let lastStamp = "";

const header = [
  "CONVERSA COM CURSOR — Galene / Spartan",
  "Exporto em texto plano: só as suas falas e as respostas do assistente.",
  "Ferramentas internas (código, git, buscas) não entram neste arquivo.",
  "Gerado em: 25/08/2026",
  "Fonte: chat Cursor (transcript 9c35dbb1-0ff3-4dd3-ad70-d720a2b8e206)",
  "",
  "================================================================",
  "",
];

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
  let body = extractTexts(content);
  if (!body) continue;
  body = redact(body);

  const isUser = role === "user" || role === "human";
  if (isUser) {
    const cleaned = cleanUser(body);
    if (!cleaned.text) continue;
    nUser += 1;
    lastRole = "user";
    lastStamp = cleaned.stamp;
    lines.push("----------------------------------------------------------------");
    lines.push(cleaned.stamp ? `VOCÊ (${nUser}) — ${cleaned.stamp}` : `VOCÊ (${nUser})`);
    lines.push("----------------------------------------------------------------");
    lines.push("");
    lines.push(cleaned.text);
    lines.push("");
  } else {
    nAsst += 1;
    lastRole = "assistant";
    lines.push("----------------------------------------------------------------");
    lines.push(lastStamp ? `CURSOR (${nAsst})` : `CURSOR (${nAsst})`);
    lines.push("----------------------------------------------------------------");
    lines.push("");
    lines.push(body);
    lines.push("");
  }
}

const out = header.concat(lines).join("\n");
fs.writeFileSync(OUT, out, "utf8");
const st = fs.statSync(OUT);
console.log(
  JSON.stringify({
    out: OUT,
    users: nUser,
    assistants: nAsst,
    bytes: st.size,
  })
);
