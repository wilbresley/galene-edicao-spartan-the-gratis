# Backup no Debian

## Pasta (zip privado — tem sidecar.auth e hashes)

```bash
TS=$(date +%Y%m%d-%H%M)
OUT="$HOME/galene-backup-$TS.zip"
cd "$HOME/docker"
sudo zip -r "$OUT" galene \
  -x "galene/recordings/*" \
  -x "galene/.plain-bak/*" \
  -x "galene/.plain-bak/**"
sudo chown "$USER:$USER" "$OUT"
ls -lh "$OUT"
```

Não subas este zip ao GitHub.

## Imagem Docker

```bash
docker save galene:local | gzip > "$HOME/galene-local-image.tgz"
```

No repo Git a cópia limpa está em `images/galene-local.tgz`. Noutro servidor:

```bash
docker load -i images/galene-local.tgz
docker compose up -d
```
