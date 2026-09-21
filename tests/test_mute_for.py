#!/usr/bin/env python3
"""Mute seletivo (azul): catálogo, UI e persistência por nick."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MuteForTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.g = (ROOT / "static" / "galene.js").read_text(encoding="utf-8")
        cls.shell = (ROOT / "static" / "spartan-servers.js").read_text(encoding="utf-8")
        cls.css = (ROOT / "static" / "galene-spartan.css").read_text(encoding="utf-8")
        cls.shell_css = (ROOT / "static" / "spartan-shell.css").read_text(encoding="utf-8")
        cls.html = (ROOT / "static" / "galene.html").read_text(encoding="utf-8")

    def test_publish_and_apply(self):
        self.assertIn("spartanMuteForV1", self.g)
        self.assertIn("function spartanToggleMuteFor", self.g)
        self.assertIn("function spartanPeerMutedTowardMe", self.g)
        self.assertIn("spartanPeerMutedTowardMe(c.source)", self.g)
        self.assertIn("cmd === 'muteFor'", self.g)

    def test_ui_colors_and_shell_btn(self):
        self.assertIn("mute-toward", self.css)
        self.assertIn("mute-all", self.css)
        self.assertIn("user-mute-for-btn", self.css)
        self.assertIn("muteFor", self.shell)
        self.assertIn("Não me ouvir", self.shell)
        self.assertIn("mute-toward", self.shell_css)

    def test_persist_mute_for(self):
        self.assertIn("ent.muteFor", self.g)
        self.assertIn("spartanMuteFor[userId] = true", self.g)

    def test_cache_bust(self):
        self.assertIn("galene.js?v=138", self.html)


if __name__ == "__main__":
    unittest.main()
