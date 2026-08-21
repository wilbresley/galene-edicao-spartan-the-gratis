# Factory reset — zera usuários do Docker Galene/Spartan

Aplica os arquivos desta pasta no servidor e deixa só a conta **admin** (ID **0**).

## Credenciais de fábrica

| Campo | Valor |
|---|---|
| Usuário | `admin` (sempre minúsculo) |
| Senha | `Mudar@123` |
| ID | `0` (imutável) |

## No Debian (pasta típica `~/docker/galene`)

```bash
cd ~/docker/galene

# 1) Copia o pacote factory-reset para o servidor (ex.: scp da pasta do repo)
#    e rode a partir dele, OU copie estes arquivos para ~/docker/galene/factory-reset/

SRC=~/docker/galene/factory-reset
test -d "$SRC" || { echo "falta $SRC"; exit 1; }

# 2) Para os serviços (opcional mas seguro)
docker stop galene spartan-reg 2>/dev/null || true

# 3) Backup rápido do estado atual
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p ~/backups/galene-pre-factory-$TS
cp -a data groups ~/backups/galene-pre-factory-$TS/ 2>/dev/null || true

# 4) Zera contas / registry / site / sidecar
cp -f "$SRC/config.json" data/config.json
cp -f "$SRC/site.json" data/site.json
cp -f "$SRC/registry.json" data/registry.json
cp -f "$SRC/accounts.json" data/accounts.json
cp -f "$SRC/sidecar.auth" data/sidecar.auth
chmod 600 data/sidecar.auth

# 5) Só a sala spartan de fábrica (apaga as outras)
rm -f groups/*.json
cp -f "$SRC/spartan.json" groups/spartan.json

# 6) Ajusta dono se o Galene roda como uid 1000
sudo chown -R 1000:1000 data groups 2>/dev/null || true
sudo chmod 600 data/sidecar.auth

# 7) Sobe de novo
docker start galene spartan-reg
# se o sidecar monta registry.py do host, reinicie após atualizar o .py:
# docker restart spartan-reg

echo "OK — login: admin / Mudar@123"
```

## Importante

- Troque `SEU_DOMINIO` em `config.json` (`proxyURL` / `canonicalHost`) pelo domínio real **antes** ou **depois** do reset.
- Nicks novos passam a ser sempre **minúsculos**; IDs não reutilizam números apagados.
- Depois do reset, atualize também o `registry.py` novo no container e faça `docker restart spartan-reg`.
