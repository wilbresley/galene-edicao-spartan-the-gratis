# Backup ZIP do Galene (estado atual do servidor)

Rode **no Debian**, na pasta `~/docker`. O zip é backup **privado** (traz `sidecar.auth` e hashes). Não jogue no GitHub.

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
echo "Backup em: $OUT"
```

`sudo` entra porque `data/registry.json` pode ser do root (o sidecar grava como root).

Gravações (`recordings/`) ficam de fora de propósito. Para incluí-las, tire as linhas `-x galene/recordings/*`.
