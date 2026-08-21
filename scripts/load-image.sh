#!/usr/bin/env bash
# Só carrega a imagem (útil se já subiu antes).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
docker load -i "$ROOT/images/galene-local.tgz"
echo "Imagem galene:local OK."
