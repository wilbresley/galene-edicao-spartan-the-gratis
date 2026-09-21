#!/usr/bin/env python3
"""TTL de 15 dias no chat de texto + limpar chat (admin/mod)."""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
TZ = ZoneInfo("America/Sao_Paulo")


def _load_registry(tmp: Path):
    spec = importlib.util.spec_from_file_location("registry_ttl", ROOT / "registry.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    # aponta data dirs para temp antes de executar o módulo
    src = (ROOT / "registry.py").read_text(encoding="utf-8")
    # carrega normalmente; testes usam funções puras com dict em memória
    spec.loader.exec_module(mod)
    return mod


class ChatTtlClearTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg_src = (ROOT / "registry.py").read_text(encoding="utf-8")
        cls.admin = (ROOT / "static" / "admin.js").read_text(encoding="utf-8")
        cls.shell = (ROOT / "static" / "spartan-servers.js").read_text(encoding="utf-8")
        cls.g = (ROOT / "static" / "galene.js").read_text(encoding="utf-8")

    def test_constants_and_endpoint(self):
        self.assertIn("SERVER_TEXT_TTL_DAYS=15", self.reg_src)
        self.assertIn("def prune_server_channel_text", self.reg_src)
        self.assertIn("def clear_server_channel_text", self.reg_src)
        self.assertIn('"/server-text-clear"', self.reg_src)
        self.assertIn("Limpar chat", self.admin)
        self.assertIn("/server-text-clear", self.admin)

    def test_client_room_chat_15d(self):
        self.assertIn("15 * 24 * 60 * 60 * 1000", self.g)

    def test_preview_and_thumb(self):
        self.assertIn("function bindPhotoPreview", self.shell)
        self.assertIn("function showLightbox", self.shell)
        self.assertIn("spartan-chat-img", self.shell)
        self.assertIn("showLightbox(url)", self.shell)

    def test_prune_logic_in_memory(self):
        mod = _load_registry(Path(tempfile.mkdtemp()))
        old = (datetime.now(TZ) - timedelta(days=20)).isoformat(timespec="seconds")
        fresh = datetime.now(TZ).isoformat(timespec="seconds")
        srv = {
            "id": "srv1",
            "text": {
                "geral": [
                    {"at": old, "nick": "a", "text": "velha"},
                    {"at": fresh, "nick": "b", "text": "nova"},
                ]
            },
            "files": {},
        }
        kept = mod.prune_server_channel_text(srv, "geral")
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]["text"], "nova")
        n = mod.clear_server_channel_text(srv, "geral")
        self.assertEqual(n, 1)
        self.assertEqual(srv["text"]["geral"], [])


if __name__ == "__main__":
    unittest.main()
