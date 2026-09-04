# Testes Spartan

Rodar no WSL/Linux com Python 3.10+:

```bash
python3 -m unittest tests.test_presence tests.test_reconnect_grace tests.test_room_login_boot tests.test_settings_ui tests.test_salas_ui -q
```

Ou com pytest, se instalado:

```bash
python3 -m pytest tests/ -q
```

| Módulo | O que cobre |
|--------|-------------|
| `test_presence` | Timer da sala / individual no servidor; reset após 60 s vazia |
| `test_reconnect_grace` | Graça 60 s; abandono silencioso preserva upstream |
| `test_room_login_boot` | Troca de sala sem flash de login |
| `test_settings_ui` | Modal Configurações + cache `?v=` |
| `test_salas_ui` / `test_admin_rooms_ui` | Lista de salas / painel |

Se o Galene local estiver em `http://127.0.0.1:8443/`, alguns testes conferem o HTML servido.
