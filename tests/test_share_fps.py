#!/usr/bin/env python3
"""FPS da tela: alvo 60 fixo na captura e no encoder."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "static" / "galene.js"
HTML = ROOT / "static" / "galene.html"


class ShareFpsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = JS.read_text(encoding="utf-8")
        cls.html = HTML.read_text(encoding="utf-8")

    def test_target_fps_is_60(self):
        m = re.search(
            r"function spartanTargetShareFps\(\) \{.*?return (\d+);",
            self.js,
            re.DOTALL,
        )
        self.assertIsNotNone(m)
        self.assertEqual(m.group(1), "60")

    def test_share_constraints_always_set_framerate(self):
        m = re.search(
            r"function spartanShareVideoConstraints\(\) \{.*?^}",
            self.js,
            re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(m)
        body = m.group(0)
        self.assertIn("frameRate", body)
        self.assertIn("spartanTargetShareFps", body)
        # Não depende mais só de gameMode para pedir 60.
        self.assertNotIn("if(gm || sq", body)
        # Chrome getDisplayMedia rejeita min.
        self.assertNotRegex(body, r"frameRate:\s*\{[^}]*min:")

    def test_sender_prefs_set_max_framerate(self):
        self.assertIn("e.maxFramerate = fps", self.js)
        self.assertIn("maintain-framerate", self.js)
        self.assertIn("spartanApplyVideoSenderPrefs", self.js)

    def test_screenshare_bitrate_independent_of_camera_send(self):
        m = re.search(
            r"async function spartanApplyVideoSenderPrefs\(.*?^}",
            self.js,
            re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(m)
        body = m.group(0)
        self.assertIn("screenshare", body)
        self.assertIn("spartanScreenBitrateCap()", body)

    def test_cache_bust(self):
        self.assertIn("galene.js?v=115", self.html)

    def test_remb_bypass_for_screenshare(self):
        self.assertIn("spartanStripRembSdp", self.js)
        self.assertIn("spartanInstallShareRembBypass", self.js)
        self.assertIn("goog-remb", self.js)


if __name__ == "__main__":
    unittest.main()
