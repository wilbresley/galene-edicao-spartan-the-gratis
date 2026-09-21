#!/usr/bin/env python3
"""Mute por nick e restauração de lives/ocultar própria no reconnect."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MuteAndReconnectRestoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.g = (ROOT / "static" / "galene.js").read_text(encoding="utf-8")
        cls.html = (ROOT / "static" / "galene.html").read_text(encoding="utf-8")

    def test_mute_authoritative_by_nick(self):
        self.assertIn("function spartanIsLocalMuted", self.g)
        self.assertIn("function spartanIsMuteForPeer", self.g)
        self.assertIn("function spartanReapplyAllPeerAudio", self.g)
        self.assertIn("spartanIsLocalMuted(c.source)", self.g)
        # delUser não pode apagar mute/volume da memória (nick ≠ peer-id)
        del_body = self.g.split("function delUser(id)", 1)[1].split("function gotUser", 1)[0]
        self.assertNotIn("delete spartanUserMuted[id]", del_body)
        self.assertNotIn("delete spartanUserVol[id]", del_body)

    def test_watch_restore_retries_on_catalog(self):
        self.assertIn("function spartanRestoreDirectedWatchesFor", self.g)
        self.assertIn("spartanRestoreDirectedWatchesFor(id)", self.g)
        self.assertIn("spartanReapplyAllPeerAudio()", self.g)

    def test_hide_own_snap_restore(self):
        self.assertIn("function spartanSnapshotHideOwn", self.g)
        self.assertIn("function spartanRestoreHideOwn", self.g)
        self.assertIn("_spartanHideOwnSnap", self.g)
        self.assertIn("spartanRestoreHideOwn()", self.g)

    def test_cache_bust(self):
        self.assertIn("galene.js?v=139", self.html)


if __name__ == "__main__":
    unittest.main()
