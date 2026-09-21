#!/usr/bin/env python3
"""Volume/mute local persistidos por nick (nÃ£o por peer-id de sessÃ£o)."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PeerAudioPersistTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.g = (ROOT / "static" / "galene.js").read_text(encoding="utf-8")
        cls.html = (ROOT / "static" / "galene.html").read_text(encoding="utf-8")

    def test_helpers_present(self):
        self.assertIn("function spartanPersistPeerAudio", self.g)
        self.assertIn("function spartanRestorePeerAudio", self.g)
        self.assertIn("spartanPeerAudio:", self.g)
        self.assertIn("spartanPersistPeerAudio(userId)", self.g)
        self.assertIn("spartanPersistPeerAudio(d.userId)", self.g)
        self.assertIn("spartanRestorePeerAudio(id)", self.g)

    def test_cache_bust(self):
        self.assertIn("galene.js?v=138", self.html)


if __name__ == "__main__":
    unittest.main()
