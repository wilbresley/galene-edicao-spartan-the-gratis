#!/usr/bin/env python3
"""Testes do layout de salas (2 colunas, permanentes + temporárias)."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GALENE_HTML = ROOT / "static" / "galene.html"
INDEX_HTML = ROOT / "static" / "index.html"
CSS = ROOT / "static" / "galene-spartan.css"
JS = ROOT / "static" / "spartan-salas.js"


class SalasUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.galene = GALENE_HTML.read_text(encoding="utf-8")
        cls.index = INDEX_HTML.read_text(encoding="utf-8")
        cls.css = CSS.read_text(encoding="utf-8")
        cls.js = JS.read_text(encoding="utf-8")

    def test_overlay_room_no_temporaries(self):
        self.assertIn("spartan-salas-grid-room", self.galene)
        self.assertIn("spartan-salas-main", self.galene)
        self.assertIn("spartan-salas-perm", self.galene)
        self.assertNotIn("spartan-salas-temp", self.galene)
        self.assertNotIn("Temporárias (24h)", self.galene)
        self.assertNotIn("spartan-salas-list", self.galene)
        self.assertNotIn("spartan-salas-pager", self.galene)

    def test_index_salas_page_no_temporaries(self):
        self.assertIn("spartan-salas-page-grid", self.index)
        self.assertIn('id="salas-main"', self.index)
        self.assertIn('id="salas-perm"', self.index)
        self.assertNotIn('id="salas-temp"', self.index)
        self.assertNotIn("Temporárias (24h)", self.index)

    def test_js_hide_temporary_default(self):
        self.assertIn("hideTemporary !== false", self.js)

    def test_js_includes_ttl_rooms(self):
        self.assertIn("s.ttl", self.js)
        self.assertIn("temporary.push", self.js)
        self.assertNotIn("if(s.ttl) return false", self.js)

    def test_css_shell_wallpaper_and_public_salas(self):
        self.assertIn("spartan-v94", self.css)
        block = self.css.split("spartan-v94", 1)[1][:2800]
        self.assertIn("html.spartan-shell", block)
        self.assertIn("papel-de-parede.jpg", block)
        self.assertIn(".spartan-salas-grid-public", block)
        self.assertIn("#salas-temp", block)

    def test_css_center_home_and_salas_cards(self):
        self.assertIn("spartan-v95", self.css)
        block = self.css.split("spartan-v95", 1)[1][:1200]
        self.assertIn("align-items:center!important", block)
        self.assertIn("align-self:center!important", block)
        self.assertIn("spartan-shell.css?v=8", self.index)
        shell = (ROOT / "static" / "spartan-shell.css").read_text(encoding="utf-8")
        self.assertIn("align-self: center !important", shell)

    def test_salas_online_and_live_css(self):
        self.assertIn(".sala-online", self.css)
        self.assertIn(".sala-live", self.css)
        js = (ROOT / "static" / "spartan-salas.js").read_text(encoding="utf-8")
        self.assertIn("startPoll", js)

    def test_main_and_perm_titles_in_room_overlay(self):
        self.assertIn("Sala principal", self.galene)
        self.assertIn("Permanentes", self.galene)


if __name__ == "__main__":
    unittest.main()
