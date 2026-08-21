# Imagem Docker congelada

`galene-local.tgz` é o `docker save` da imagem `galene:local` do servidor (20/08/2026), ~10 MB.

O Compose **não** baixa `.tgz` sozinho. No Debian:

```bash
chmod +x scripts/load-image.sh
./scripts/load-image.sh
docker compose up -d
```

Ou:

```bash
docker load -i images/galene-local.tgz
docker compose up -d
```

Não use `docker compose up --build`: isso recompilaria e poderia sair desta imagem.
