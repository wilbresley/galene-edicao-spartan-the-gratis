#!/usr/bin/env bash
# Instalador completo — Galene + Spartan (sempre sala CONVITE)
# Uso: chmod +x scripts/instalar-completo.sh && ./scripts/instalar-completo.sh
#
# Pergunta domínio/IPs/senhas, grava configs, sobe Docker e no final
# lista o que SÓ VOCÊ pode fazer (DNS, roteador, firewall).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; CYN=$'\033[36m'; BLD=$'\033[1m'; RST=$'\033[0m'

say()  { printf '%s\n' "$*"; }
ok()   { printf '%s%s%s\n' "$GRN" "$*" "$RST"; }
warn() { printf '%s%s%s\n' "$YLW" "$*" "$RST"; }
err()  { printf '%s%s%s\n' "$RED" "$*" "$RST" >&2; }
title(){ printf '\n%s%s%s\n' "$BLD$CYN" "$*" "$RST"; }

ask() {
  # ask VAR "pergunta" "default"
  local __var="$1" __q="$2" __def="${3-}" __ans
  if [[ -n "$__def" ]]; then
    read -r -p "$__q [$__def]: " __ans || true
    __ans="${__ans:-$__def}"
  else
    while true; do
      read -r -p "$__q: " __ans || true
      [[ -n "$__ans" ]] && break
      warn "  (obrigatório — digite um valor)"
    done
  fi
  printf -v "$__var" '%s' "$__ans"
}

ask_secret() {
  # ask_secret VAR "rótulo"
  local __var="$1" __lab="$2" __a __b
  while true; do
    read -r -s -p "$__lab: " __a; echo
    read -r -s -p "Repita $__lab: " __b; echo
    if [[ "$__a" != "$__b" ]]; then warn "  Senhas diferentes. Tente de novo."; continue; fi
    if [[ ${#__a} -lt 8 ]]; then warn "  Mínimo 8 caracteres."; continue; fi
    if [[ "$__a" == "Mudar@123" ]]; then warn "  Não use a senha de fábrica."; continue; fi
    printf -v "$__var" '%s' "$__a"
    break
  done
}

hash_pw() {
  # hash_pw SENHA -> imprime JSON pbkdf2 numa linha
  local pw="$1"
  PASSWORD="$pw" python3 - <<'PY'
import os, hashlib, json
pw = os.environ["PASSWORD"].encode()
salt = os.urandom(8)
key = hashlib.pbkdf2_hmac("sha256", pw, salt, 4096, dklen=32)
print(json.dumps({
  "type": "pbkdf2", "hash": "sha-256",
  "key": key.hex(), "salt": salt.hex(), "iterations": 4096
}, separators=(",", ":")))
PY
}

detect_public_ip() {
  local ip=""
  ip="$(curl -4 -fsS --max-time 4 https://ifconfig.me 2>/dev/null || true)"
  [[ -z "$ip" ]] && ip="$(curl -4 -fsS --max-time 4 https://api.ipify.org 2>/dev/null || true)"
  printf '%s' "$ip"
}

detect_lan_ip() {
  local ip=""
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -z "$ip" ]] && ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '/src/{print $7; exit}')"
  printf '%s' "${ip:-192.168.0.10}"
}

slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

# --- pré-checagens ---
title "=== Instalador Spartan Chat (sala CONVITE) ==="
say "Este script configura o servidor e sobe os containers."
say "Ele NÃO abre portas no roteador sozinho — no final você recebe o checklist."
say ""

command -v docker >/dev/null || { err "Instale o Docker primeiro."; exit 1; }
docker compose version >/dev/null 2>&1 || { err "Instale o Docker Compose v2 (plugin compose)."; exit 1; }
command -v python3 >/dev/null || { err "Precisa de python3 (para gerar hash das senhas)."; exit 1; }
command -v curl >/dev/null || warn "curl não encontrado — você digita o IP público na mão."

if [[ -f data/config.json || -f groups/spartan.json ]]; then
  warn "Já existem arquivos em data/ ou groups/."
  ask OVERWRITE "Apagar config atual e reinstalar do zero? (sim/nao)" "nao"
  if [[ "$OVERWRITE" =~ ^([sS]im|s|S|y|Y)$ ]]; then
    mkdir -p .plain-bak
    TS="$(date +%Y%m%d-%H%M%S)"
    tar czf ".plain-bak/antes-instalar-$TS.tgz" data groups .env 2>/dev/null || true
    ok "Backup rápido em .plain-bak/antes-instalar-$TS.tgz"
  else
    err "Cancelado. Use ./scripts/subir.sh se só quiser ligar o que já existe."
    exit 0
  fi
fi

SUG_PUB="$(detect_public_ip)"
SUG_LAN="$(detect_lan_ip)"

# --- perguntas ---
title "1) Rede — IP público (TURN)"
say "O que é: endereço do servidor na INTERNET (não o Wi‑Fi 192.168…)."
say "Para quê: o TURN usa isso para áudio/vídeo funcionar fora da sua casa."
say "Onde achar: painel do VPS, ou no servidor rode: curl -4 ifconfig.me"
ask PUBLIC_IP "Digite o IP público" "${SUG_PUB:-}"

title "2) Rede — IP local (LAN)"
say "O que é: IP do servidor na rede interna (ex.: 192.168.100.16)."
say "Para quê: no Nginx Proxy Manager você aponta para http://ESTE_IP:8443"
say "Onde achar: no servidor: hostname -I"
ask LAN_IP "Digite o IP da LAN" "$SUG_LAN"

title "3) Domínio (opcional agora)"
say "O que é: nome bonito tipo chat.seudominio.com (precisa apontar no DNS para o IP público)."
say "Se ainda não tem, digite 'nao' — usamos o IP por enquanto."
ask HAS_DOMAIN "Vai usar domínio agora? (sim/nao)" "nao"
DOMAIN=""
PROXY_URL="http://${LAN_IP}:8443/"
CANON="${LAN_IP}:8443"
if [[ "$HAS_DOMAIN" =~ ^([sS]im|s|S|y|Y)$ ]]; then
  ask DOMAIN "Qual o domínio? (sem https://)" ""
  DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"
  PROXY_URL="https://${DOMAIN}/"
  CANON="$DOMAIN"
fi

title "4) Sala (sempre CONVITE)"
say "A sala inicial SEMPRE pede nick + senha de amigos."
say "Assim ninguém se confunde (sala pública esconde a senha e complica o admin)."
say "Depois, no painel /admin/: convite definitiva (padrão), convite 24h, ou pública (sempre 24h)."
say "Anfitrião (op só daquela sala, sem painel) só existe nas salas de 24h."
ask ROOM_SLUG "Nome na URL (minúsculo, sem espaço)" "spartan"
ROOM_SLUG="$(slugify "$ROOM_SLUG")"
[[ -z "$ROOM_SLUG" ]] && ROOM_SLUG="spartan"
ask ROOM_TITLE "Título da sala (aparece na home)" "Spartan"

title "5) Conta admin"
say "É a conta que entra na sala E no painel /admin/."
ask ADMIN_USER "Usuário admin" "admin"
ADMIN_USER="$(echo "$ADMIN_USER" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
ask_secret ADMIN_PASS "Senha do admin"

title "6) Senha dos convidados (amigos)"
say "Quem NÃO tem conta cadastrada entra na sala com nick + ESTA senha."
say "Deve ser DIFERENTE da senha do admin."
ask_secret FRIENDS_PASS "Senha dos convidados"
if [[ "$FRIENDS_PASS" == "$ADMIN_PASS" ]]; then
  err "Senha dos convidados não pode ser igual à do admin."
  exit 1
fi

title "7) Confirmação"
say "IP público (TURN):  $PUBLIC_IP"
say "IP LAN (proxy):     $LAN_IP"
say "Domínio/URL:        $PROXY_URL"
say "Sala:               /$ROOM_SLUG/  ($ROOM_TITLE) — CONVITE"
say "Admin:              $ADMIN_USER"
say "Convidados:         (senha definida)"
say ""
ask GO "Tudo certo? Digite sim para gravar e subir" "sim"
[[ "$GO" =~ ^([sS]im|s|S|y|Y)$ ]] || { err "Cancelado."; exit 0; }

# --- gravar arquivos ---
title "Gravando configuração…"
mkdir -p data groups recordings .plain-bak

HASH_ADMIN="$(hash_pw "$ADMIN_PASS")"
HASH_FRIENDS="$(hash_pw "$FRIENDS_PASS")"

cat > .env <<EOF
# Gerado por scripts/instalar-completo.sh
TURN_PUBLIC_IP=$PUBLIC_IP
EOF

cat > data/sidecar.auth <<EOF
$ADMIN_USER:$ADMIN_PASS
EOF
chmod 600 data/sidecar.auth

cat > data/site.json <<EOF
{"main":"$ROOM_SLUG","home":"$ROOM_SLUG"}
EOF

cat > data/registry.json <<EOF
{}
EOF

cat > data/accounts.json <<EOF
{
  "next_id": 1,
  "by_id": {
    "0": {
      "nick": "$ADMIN_USER",
      "active": true,
      "created": "installer",
      "must_change": false
    }
  },
  "by_nick": {
    "$ADMIN_USER": 0
  }
}
EOF

# config.json via python para embutir JSON do hash com segurança
ADMIN_USER="$ADMIN_USER" PROXY_URL="$PROXY_URL" CANON="$CANON" HASH_ADMIN="$HASH_ADMIN" python3 - <<'PY'
import json, os
cfg = {
  "proxyURL": os.environ["PROXY_URL"],
  "canonicalHost": os.environ["CANON"],
  "writableGroups": True,
  "users": {
    os.environ["ADMIN_USER"]: {
      "password": json.loads(os.environ["HASH_ADMIN"]),
      "permissions": "admin"
    }
  }
}
open("data/config.json","w",encoding="utf-8").write(json.dumps(cfg, indent=2) + "\n")
PY

ROOM_SLUG="$ROOM_SLUG" ROOM_TITLE="$ROOM_TITLE" ADMIN_USER="$ADMIN_USER" \
HASH_ADMIN="$HASH_ADMIN" HASH_FRIENDS="$HASH_FRIENDS" python3 - <<'PY'
import json, os
slug = os.environ["ROOM_SLUG"]
group = {
  "public": True,
  "displayName": os.environ["ROOM_TITLE"],
  "description": "",
  "codecs": ["vp9", "vp8", "opus"],
  "unrestricted-tokens": True,
  "users": {
    os.environ["ADMIN_USER"]: {
      "password": json.loads(os.environ["HASH_ADMIN"]),
      "permissions": "op"
    }
  },
  "wildcard-user": {
    "password": json.loads(os.environ["HASH_FRIENDS"]),
    "permissions": "present"
  }
}
# limpa outras salas de fábrica se o slug mudou
import pathlib
gdir = pathlib.Path("groups")
for p in gdir.glob("*.json"):
    if p.name.endswith(".example.json"):
        continue
    if p.stem != slug:
        p.unlink()
open(f"groups/{slug}.json","w",encoding="utf-8").write(json.dumps(group, indent=2) + "\n")
PY

# memo local (não secreto demais — senhas NÃO vão aqui)
cat > data/INSTALACAO-RESUMO.txt <<EOF
Gerado em: $(date -Iseconds)
IP público (TURN): $PUBLIC_IP
IP LAN: $LAN_IP
URL base: $PROXY_URL
Sala: /group/$ROOM_SLUG/ ($ROOM_TITLE) — CONVITE
Admin: $ADMIN_USER
EOF

ok "Arquivos gravados."
if [[ -f static/sounds/entrar.mp3 && -f static/sounds/sair.mp3 && -f static/sounds/mensagem.mp3 ]]; then
  ok "Sons da sala: static/sounds/{entrar,sair,mensagem}.mp3"
else
  warn "Faltam MP3 em static/sounds/ (entrar.mp3, sair.mp3, mensagem.mp3). A sala sobe, mas os avisos sonoros não tocam."
fi

title "Docker…"
docker load -i images/galene-local.tgz
docker compose up -d
sleep 2
docker compose ps || true

# links
if [[ -n "$DOMAIN" ]]; then
  BASE="https://${DOMAIN}"
else
  BASE="http://${LAN_IP}:8443"
fi

title "=============================================="
ok " INSTALAÇÃO NO SERVIDOR CONCLUÍDA"
title "=============================================="
say ""
say "Abra no navegador:"
say "  Home:  ${BASE}/   (landing Cadê a Live? — não é o painel)"
say "  Sala:  ${BASE}/group/${ROOM_SLUG}/"
say "  Admin: ${BASE}/admin/"
say ""
say "Login admin:  usuário ${ADMIN_USER}  + a senha que você definiu"
say "Convidados:   qualquer nick + a senha de amigos que você definiu"
say ""
warn "========== O QUE O SCRIPT NÃO FAZ (você precisa) =========="
say ""
say "${BLD}A) DNS (se tiver domínio)${RST}"
if [[ -n "$DOMAIN" ]]; then
  say "  No provedor do domínio, crie um registro A:"
  say "    ${DOMAIN}  →  ${PUBLIC_IP}"
  say "  Espere propagar (minutos a algumas horas)."
else
  say "  Você escolheu sem domínio. Quando tiver um:"
  say "  1) Aponte o domínio para ${PUBLIC_IP}"
  say "  2) Edite data/config.json (proxyURL e canonicalHost)"
  say "  3) docker compose restart"
fi
say ""
say "${BLD}B) Proxy HTTPS (Nginx Proxy Manager / Caddy / Nginx)${RST}"
say "  Crie um Proxy Host:"
say "    Domínio: ${DOMAIN:-SEU_DOMINIO}"
say "    Destino: http://${LAN_IP}:8443"
say "    Ligue WebSocket / websockets"
say "    SSL (Let's Encrypt) quando o DNS já apontar"
say ""
say "${BLD}C) Firewall do servidor (UFW exemplo)${RST}"
say "  sudo ufw allow 8443/tcp comment 'galene-http-local'"
say "  sudo ufw allow 1194/tcp comment 'galene-turn'"
say "  sudo ufw allow 1194/udp comment 'galene-turn'"
say "  sudo ufw allow 50000:50100/udp comment 'galene-rtp'"
say "  (Se o proxy está na mesma máquina, 8443 pode ficar só LAN.)"
say ""
say "${BLD}D) Roteador (se o servidor está em casa)${RST}"
say "  Encaminhe (port forward) para o IP LAN ${LAN_IP}:"
say "    1194 TCP  → ${LAN_IP}:1194"
say "    1194 UDP  → ${LAN_IP}:1194"
say "    50000-50100 UDP → ${LAN_IP}:50000-50100"
say "  Sem isso, gente na INTERNET/4G costuma ficar sem áudio/vídeo."
say ""
say "${BLD}E) O que é TURN (explicação curta)${RST}"
say "  É o 'carteiro' do áudio/vídeo quando a internet complica (NAT/4G)."
say "  O Galene já traz TURN. Ele anuncia o IP público do arquivo .env"
say "  (TURN_PUBLIC_IP=${PUBLIC_IP}). Por isso liberar 1194 e 50000-50100 importa."
say ""
say "Resumo salvo em: data/INSTALACAO-RESUMO.txt"
say "Logs: docker compose logs -f"
say "Parar: docker compose down"
ok "Boa call!"
