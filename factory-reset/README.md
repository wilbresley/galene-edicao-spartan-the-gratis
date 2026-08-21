# Factory reset — zera usuários do Docker Galene/Spartan

Deixa só a conta **admin** (ID **0**).

| Campo | Valor |
|---|---|
| Usuário | `admin` |
| Senha do admin | `Mudar@123` (fábrica — trocar no 1º login) |
| Senha dos convidados (sala) | `Mudar@123` (fábrica — trocar no 1º login) |
| Sala | **Convite** (não pública) → convidados entram como **Verificado** |
| Cargos | Admin / Verificado / Ouvinte (temporários só em salas públicas) |

No primeiro login o admin **deve** trocar as duas senhas.

Ajuste `proxyURL` / `canonicalHost` em `config.json` para o teu domínio.
