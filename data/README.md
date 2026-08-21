# Não grave senha em claro nos JSON finais.

```bash
cp .env.example .env
cp data/config.example.json data/config.json
cp data/site.example.json data/site.json
cp data/sidecar.auth.example data/sidecar.auth
chmod 600 data/sidecar.auth
cp groups/sala-principal.example.json groups/sala-principal.json
```

1. `.env` — **IP público** (`curl -4 ifconfig.me`).
2. Hash do operador (a imagem não traz `galenectl`):

```bash
python3 - << 'PY'
import os, hashlib, json
pw = input("Senha do operador: ").strip()
salt = os.urandom(8)
key = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 4096, dklen=32)
print(json.dumps({
  "type": "pbkdf2", "hash": "sha-256",
  "key": key.hex(), "salt": salt.hex(), "iterations": 4096
}, indent=2))
PY
```

Cola o objeto em `data/config.json` e `groups/sala-principal.json`. Não uses `"type": "wildcard"` na senha do admin.

3. `sidecar.auth` — `usuario:senha` em claro, modo `0600`, a mesma conta admin. Não commites.

4. Pública: wildcard `"password": {"type": "wildcard"}`.  
   Convite: wildcard com objeto hash (senha dos amigos).
