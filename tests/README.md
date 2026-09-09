# Testes Spartan

Rodar no WSL/Linux com Python 3.10+:

```bash
python3 -m unittest tests.test_presence tests.test_reconnect_grace tests.test_room_login_boot tests.test_settings_ui tests.test_salas_ui tests.test_live_buttons tests.test_admin_rooms_ui tests.test_share_fps -q
```

Ou com pytest, se instalado:

```bash
python3 -m pytest tests/ -q
```

| Módulo | O que cobre |
|--------|-------------|
| `test_presence` | Timer da sala / individual no servidor; sala vazia segue 5 min e zera |
| `test_live_buttons` | Pedido de vídeo só com live aberta; fechar não derruba a transmissão |
| `test_reconnect_grace` | Graça 60 s; abandono silencioso preserva upstream |
| `test_room_login_boot` | Troca de sala sem flash de login |
| `test_settings_ui` | Modal Configurações + cache `?v=` |
| `test_salas_ui` / `test_admin_rooms_ui` | Lista de salas / painel |

Se o Galene local estiver em `http://127.0.0.1:8443/`, alguns testes conferem o HTML servido.
