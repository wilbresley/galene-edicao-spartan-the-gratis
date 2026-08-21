#!/usr/bin/env bash
# Sobe o Spartan Chat (Galene) com UM comando.
# Uso (Linux/Debian/Ubuntu/WSL2):
#   chmod +x scripts/subir.sh && ./scripts/subir.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Spartan Chat — bootstrap"
command -v docker >/dev/null || { echo "Instale o Docker primeiro."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Instale o Docker Compose v2 (plugin compose)."; exit 1; }

if [[ ! -f .env ]]; then
  cp .env.example .env
  # tenta detectar IP público para o TURN
  IP=""
  IP="$(curl -4 -fsS --max-time 4 https://ifconfig.me 2>/dev/null || true)"
  if [[ -z "$IP" ]]; then
    IP="$(curl -4 -fsS --max-time 4 https://api.ipify.org 2>/dev/null || true)"
  fi
  if [[ -z "$IP" ]]; then
    IP="SEU_IP_PUBLICO"
    echo "!! Não detectei IP público. Edite .env e coloque TURN_PUBLIC_IP=..."
  else
    echo "IP público detectado: $IP"
  fi
  # sed portável
  if grep -q 'TURN_PUBLIC_IP=' .env; then
    sed -i.bak "s/^TURN_PUBLIC_IP=.*/TURN_PUBLIC_IP=${IP}/" .env || true
    rm -f .env.bak
  fi
fi

# dados prontos (fábrica) — não sobrescreve se já existirem
mkdir -p data groups recordings
[[ -f data/config.json ]] || cp factory-reset/config.json data/config.json
[[ -f data/site.json ]] || cp factory-reset/site.json data/site.json
[[ -f data/accounts.json ]] || cp factory-reset/accounts.json data/accounts.json
[[ -f data/registry.json ]] || cp factory-reset/registry.json data/registry.json
[[ -f data/sidecar.auth ]] || cp factory-reset/sidecar.auth data/sidecar.auth
chmod 600 data/sidecar.auth 2>/dev/null || true
[[ -f groups/spartan.json ]] || cp factory-reset/spartan.json groups/spartan.json

echo "==> Carregando imagem galene:local (do repositório)…"
docker load -i images/galene-local.tgz

echo "==> Subindo containers…"
docker compose up -d

echo
echo "=============================================="
echo " Pronto!"
echo " Sala:   http://127.0.0.1:8443/group/spartan/"
echo " Admin:  http://127.0.0.1:8443/admin/"
echo " Home:   http://127.0.0.1:8443/"
echo
echo " Login fábrica (troque no 1º acesso):"
echo "   usuário: admin"
echo "   senha:   Mudar@123"
echo
echo " Logs: docker compose logs -f"
echo " Parar: docker compose down"
echo "=============================================="
