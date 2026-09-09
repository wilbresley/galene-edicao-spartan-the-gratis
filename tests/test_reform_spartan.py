#!/usr/bin/env python3
"""Reformulação: sessão, origem, painel único, lock do registry."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReformSessionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.galene = (ROOT / "static" / "galene.js").read_text(encoding="utf-8")
        cls.net = (ROOT / "static" / "spartan-net.js").read_text(encoding="utf-8")
        cls.shell = (ROOT / "static" / "spartan-shell.js").read_text(encoding="utf-8")
        cls.admin = (ROOT / "static" / "admin.js").read_text(encoding="utf-8")
        cls.settings = (ROOT / "static" / "settings.js").read_text(encoding="utf-8")
        cls.painel = (ROOT / "static" / "painel.html").read_text(encoding="utf-8")
        cls.painel_idx = (ROOT / "static" / "painel" / "index.html").read_text(encoding="utf-8")
        cls.index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        cls.reg = (ROOT / "registry.py").read_text(encoding="utf-8")

    def test_post_message_uses_origin(self):
        self.assertIn("postMessage(data, location.origin)", self.net)
        self.assertIn("ev.origin !== location.origin", self.shell)
        self.assertIn("postMessage({t:'spartan-admin-close'}, location.origin)", self.admin)
        self.assertNotIn("postMessage(data, '*')", self.net)
        self.assertNotIn("postMessage({t:'spartan-admin-close'},'*')", self.admin)

    def test_admin_password_not_written_to_local_storage(self):
        self.assertIn("sessionStorage.setItem('spartanAdmin'", self.galene)
        self.assertIn("localStorage.removeItem('spartanAdminHandoff')", self.galene)
        self.assertNotIn("localStorage.setItem('spartanAdminHandoff'", self.galene)
        self.assertIn("localStorage.setItem('spartanPrefs'", self.settings)

    def test_painel_redirects_to_admin(self):
        self.assertIn("/admin/", self.painel)
        self.assertIn("location.replace", self.painel)
        self.assertIn("/admin/", self.painel_idx)
        self.assertNotIn("painel.js", self.painel)

    def test_prefetch_matches_room_cache(self):
        self.assertIn("galene.js?v=118", self.index)
        self.assertIn("protocol.js?v=4", self.index)
        self.assertIn("spartan-shell.js?v=5", self.index)

    def test_registry_atomic_save(self):
        self.assertIn("def mutate_registry", self.reg)
        self.assertIn("def load_unlocked", self.reg)
        self.assertIn("def save_unlocked", self.reg)
        self.assertIn("with _SAVE_LOCK", self.reg)
        self.assertIn("t.replace(DATA)", self.reg)


if __name__ == "__main__":
    unittest.main()
