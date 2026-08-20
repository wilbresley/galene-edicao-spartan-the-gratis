# Não grave senha em claro nos JSON finais.

Copie os exemplos:

```bash
cp .env.example .env
cp data/config.example.json data/config.json
cp data/site.example.json data/site.json
cp data/sidecar.auth.example data/sidecar.auth
chmod 600 data/sidecar.auth
cp groups/sala-principal.example.json groups/sala-principal.json
```

Depois:

1. Edite `.env` com o **IP público** (TURN).
2. Em `data/config.json` e `groups/sala-principal.json`, troque `OPERADOR` e **não deixe** `"type": "wildcard"` na senha do admin. Gere hash:

```bash
docker compose run --rm --entrypoint /app/galene galene -hash-password
```

(Se a flag mudar na sua versão, veja `galene -help`.) Cole o objeto hash no campo `password`.

3. `sidecar.auth` é `usuario:senha` **em claro**, a mesma conta admin do `config.json`, modo `0600`. Não commite.

4. Sala pública: wildcard `"password": {"type": "wildcard"}`.
   Sala convite: wildcard com senha **hasheada**.
