# Carrega a imagem Galene congelada que está neste repositório.
# Rode no servidor (Debian) depois do git clone / git pull.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
docker load -i "$ROOT/images/galene-local.tgz"
echo "Imagem galene:local carregada. Agora: docker compose up -d"
