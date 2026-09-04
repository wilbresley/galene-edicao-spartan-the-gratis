#!/usr/bin/env python3
"""Reconexão silenciosa: tolerância de 1 min e preservação de mídia."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GALENE_JS = ROOT / "static" / "galene.js"
GALENE_HTML = ROOT / "static" / "galene.html"


class ReconnectGraceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = GALENE_JS.read_text(encoding="utf-8")
        cls.html = GALENE_HTML.read_text(encoding="utf-8")

    def test_grace_period_one_minute(self):
        self.assertIn("const SPARTAN_GRACE_MS = 60000;", self.js)

    def test_silent_abandon_preserves_upstream(self):
        m = re.search(
            r"function spartanAbandonConnection\(sc, silent\) \{.*?^}\n",
            self.js,
            re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(m)
        body = m.group(0)
        self.assertIn("if(silent)", body)
        self.assertIn("sc.up = {};", body)
        self.assertNotIn("sc.up[id].close(!!silent)", body)

    def test_join_restores_media_before_forcing_mute(self):
        m = re.search(
            r"async function gotJoined\(.*?\n\}",
            self.js,
            re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(m)
        body = m.group(0)
        republish = body.find("spartanRepublishUps")
        restore = body.find("spartanRestoreMediaAfterReconnect")
        force_mute = body.find("setLocalMute(true, true)")
        self.assertGreater(republish, 0)
        self.assertGreater(restore, republish)
        self.assertGreater(force_mute, restore)

    def test_galene_js_cache_bust_v106(self):
        self.assertIn("galene.js?v=115", self.html)


if __name__ == "__main__":
    unittest.main()
