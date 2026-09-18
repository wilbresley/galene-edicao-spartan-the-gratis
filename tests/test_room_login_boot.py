#!/usr/bin/env python3
"""Troca de sala sem piscar a tela de login."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOOT = ROOT / "static" / "spartan-boot.js"
GALENE_JS = ROOT / "static" / "galene.js"
GALENE_HTML = ROOT / "static" / "galene.html"


class RoomLoginBootTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.boot = BOOT.read_text(encoding="utf-8")
        cls.js = GALENE_JS.read_text(encoding="utf-8")
        cls.html = GALENE_HTML.read_text(encoding="utf-8")

    def test_boot_checks_global_and_guest_cred(self):
        self.assertIn("spartanGlobalCred", self.boot)
        self.assertIn("spartanGuestCred:", self.boot)
        self.assertIn("spartan-rejoin", self.boot)

    def test_boot_cache_bust_v9(self):
        self.assertIn("spartan-boot.js?v=11", self.html)

    def test_boot_copies_parent_session(self):
        self.assertIn("window.parent.sessionStorage", self.boot)
        self.assertIn("spartanGlobalCred", self.boot)
        self.assertIn("spartan-in-shell", self.boot)

    def test_start_hides_login_before_auto_connect(self):
        m = re.search(
            r"async function start\(\) \{.*?\nstart\(\);",
            self.js,
            re.DOTALL,
        )
        self.assertIsNotNone(m, "start() não encontrado")
        body = m.group(0)
        auto = body.split("await spartanPrepareOpenRoom();", 1)[1]
        self.assertIn("setVisibility('login-container', false)", auto)
        self.assertNotRegex(
            auto,
            r"setVisibility\('login-container', true\).*spartanLoadStoredSession",
        )

    def test_galene_js_cache_bust_v105(self):
        self.assertIn("galene.js?v=136", self.html)
        self.assertIn("spartanLiveHeaderTick", self.js)
        self.assertIn("spartanSyncPresence", self.js)
        self.assertIn("spartanStoreGet", self.js)
        self.assertIn("window.parent.sessionStorage", self.js)


if __name__ == "__main__":
    unittest.main()
