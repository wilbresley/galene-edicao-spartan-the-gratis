#!/usr/bin/env python3
"""Testes do layout da aba Salas no painel admin."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADMIN_HTML = ROOT / "static" / "admin" / "index.html"
ADMIN_CSS = ROOT / "static" / "admin.css"
ADMIN_JS = ROOT / "static" / "admin.js"


class AdminRoomsUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = ADMIN_HTML.read_text(encoding="utf-8")
        cls.css = ADMIN_CSS.read_text(encoding="utf-8")
        cls.js = ADMIN_JS.read_text(encoding="utf-8")

    def test_two_column_grid_markup(self):
        self.assertIn("rooms-grid", self.html)
        self.assertIn('id="rooms-main"', self.html)
        self.assertIn('class="rooms-main-slot"', self.html)
        self.assertIn('id="rooms-perm"', self.html)
        self.assertIn('id="rooms-temp"', self.html)
        self.assertIn("Sala principal", self.html)
        self.assertIn("Temporárias (24h)", self.html)
        self.assertIn("Canais de voz dos servidores não entram nesta lista", self.html)
        self.assertNotIn("rooms-scroll", self.html)

    def test_css_two_columns_full_width(self):
        self.assertIn("admin-v27", self.css)
        block = self.css.split("admin-v27", 1)[1][:1800]
        self.assertIn(".rooms-grid", block)
        self.assertIn("grid-template-columns:1fr 1fr", block)
        self.assertIn(".rooms-col-title", block)
        self.assertIn("background:#000", block)

    def test_cache_bust_admin_css(self):
        self.assertIn("admin.css?v=39", self.html)
        self.assertIn("admin.js?v=56", self.html)

    def test_server_voice_hidden_and_open_uses_shell(self):
        self.assertIn("server_voice", self.js)
        self.assertIn("meta[n].server_voice", self.js)
        self.assertIn("function openRoomHref", self.js)
        self.assertIn("/#/s/", self.js)
        self.assertNotIn("open.href='/group/'", self.js)

    def test_embed_hides_inner_header(self):
        self.assertIn("html.admin-in-shell .admin-top{display:none!important}", self.css)

    def test_server_icon_hides_native_file_picker(self):
        self.assertIn(".server-icon-file", self.css)
        hide = self.css.split(".server-icon-file", 1)[1].split("}", 1)[0]
        self.assertIn("display:none!important", hide)
        self.assertIn("iconFile.className='server-icon-file'", self.js)
        self.assertIn("tools.appendChild(iconFile)", self.js)
        self.assertNotIn("iconRow.appendChild(iconFile)", self.js)


if __name__ == "__main__":
    unittest.main()
