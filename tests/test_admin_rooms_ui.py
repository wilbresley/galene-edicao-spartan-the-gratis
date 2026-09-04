#!/usr/bin/env python3
"""Testes do layout da aba Salas no painel admin."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADMIN_HTML = ROOT / "static" / "admin" / "index.html"
ADMIN_CSS = ROOT / "static" / "admin.css"


class AdminRoomsUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = ADMIN_HTML.read_text(encoding="utf-8")
        cls.css = ADMIN_CSS.read_text(encoding="utf-8")

    def test_two_column_grid_markup(self):
        self.assertIn("rooms-grid", self.html)
        self.assertIn('id="rooms-main"', self.html)
        self.assertIn('class="rooms-main-slot"', self.html)
        self.assertIn('id="rooms-perm"', self.html)
        self.assertIn('id="rooms-temp"', self.html)
        self.assertIn("Sala principal", self.html)
        self.assertIn("Temporárias (24h)", self.html)
        self.assertNotIn("rooms-scroll", self.html)

    def test_css_two_columns_full_width(self):
        self.assertIn("admin-v27", self.css)
        block = self.css.split("admin-v27", 1)[1][:1800]
        self.assertIn(".rooms-grid", block)
        self.assertIn("grid-template-columns:1fr 1fr", block)
        self.assertIn(".rooms-col-title", block)
        self.assertIn("background:#000", block)

    def test_cache_bust_admin_css(self):
        self.assertIn("admin.css?v=28", self.html)

    def test_embed_hides_inner_header(self):
        self.assertIn("html.admin-in-shell .admin-top{display:none!important}", self.css)


if __name__ == "__main__":
    unittest.main()
