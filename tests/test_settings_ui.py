#!/usr/bin/env python3
"""Testes do modal Configurações (HTML + CSS Spartan).

Rodar: python -m pytest tests/test_settings_ui.py -v
"""
from __future__ import annotations

import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "static" / "galene.html"
CSS = ROOT / "static" / "galene-spartan.css"


class _SettingsTree(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack: list[str] = []
        self.cols: dict | None = None
        self.left_children: list[str] = []
        self.right_children: list[str] = []
        self.titles: list[str] = []
        self.sound_ids: list[str] = []
        self._in_cols = False
        self._in_left = False
        self._in_right = False
        self._in_title = False
        self._title_buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        cls = attrs_d.get("class", "")
        eid = attrs_d.get("id", "")
        self.stack.append(tag)

        if tag == "div" and "spartan-settings-cols" in cls.split():
            self._in_cols = True
            self.cols = {"left": None, "right": None}
        if self._in_cols and tag == "div" and "spartan-settings-left" in cls.split():
            self._in_left = True
        if self._in_cols and tag == "div" and "spartan-settings-right" in cls.split():
            self._in_right = True
        if self._in_left and tag == "fieldset":
            self.left_children.append(cls or eid or tag)
        if self._in_right and tag == "fieldset":
            self.right_children.append(cls or eid or tag)
        if tag == "div" and "spartan-set-title" in cls.split():
            self._in_title = True
            self._title_buf = []
        if eid in ("soundmensagembox", "soundentrarbox", "soundsairbox"):
            self.sound_ids.append(eid)

    def handle_endtag(self, tag):
        closed_title = False
        if tag == "div" and self._in_title:
            self.titles.append("".join(self._title_buf).strip())
            self._in_title = False
            closed_title = True
        if tag == "div" and not closed_title:
            if self.stack and self.stack[-1] == "div":
                if self._in_right:
                    self._in_right = False
                elif self._in_left:
                    self._in_left = False
                elif self._in_cols:
                    self._in_cols = False
        if self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if self._in_title:
            self._title_buf.append(data)


def _parse_settings() -> _SettingsTree:
    tree = _SettingsTree()
    tree.feed(HTML.read_text(encoding="utf-8"))
    return tree


class SettingsUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = HTML.read_text(encoding="utf-8")
        cls.css = CSS.read_text(encoding="utf-8")
        cls.tree = _parse_settings()

    def test_html_cache_bust_css_v98(self):
        self.assertIn("galene-spartan.css?v=98", self.html)
        self.assertIn('id="spartan-live"', self.html)
        self.assertNotIn("Ao vivo:", self.html)
        self.assertIn("00:00:00", self.html)

    def test_no_legacy_sound_sections(self):
        self.assertNotIn("Som do chat", self.html)
        self.assertNotIn("Sons da sala", self.html)
        self.assertNotIn("spartan-sound-chat", self.html)
        self.assertNotIn("spartan-sound-room", self.html)

    def test_unified_sounds_field(self):
        self.assertIn("spartan-sounds-setting", self.html)
        self.assertEqual(self.tree.sound_ids, ["soundmensagembox", "soundentrarbox", "soundsairbox"])
        self.assertIn("Sons", self.tree.titles)
        self.assertEqual(self.tree.titles.count("Sons"), 1)

    def test_column_structure(self):
        self.assertIsNotNone(self.tree.cols)
        self.assertTrue(any("spartan-set-box" in x for x in self.tree.left_children))
        self.assertTrue(any("spartan-transmit-setting" in x for x in self.tree.right_children))
        self.assertTrue(any("spartan-sounds-setting" in x for x in self.tree.right_children))
        self.assertEqual(len(self.tree.right_children), 2)

    def test_titles_only_dispositivos_transmissao_sons(self):
        wanted = {"Dispositivos", "Transmissão", "Sons"}
        found = {t for t in self.tree.titles if t in wanted}
        self.assertEqual(found, wanted)
        self.assertNotIn("<legend>Dispositivos</legend>", self.html)
        self.assertNotIn("<legend>Transmissão</legend>", self.html)
        self.assertNotIn("<legend>Sons</legend>", self.html)

    def test_transmissao_not_in_left_column(self):
        self.assertFalse(any("spartan-transmit-setting" in x for x in self.tree.left_children))

    def test_css_settings_columns_tight(self):
        self.assertIn("spartan-v93", self.css)
        block = self.css.split("spartan-v93", 1)[1][:1200]
        self.assertIn(".spartan-settings-cols", block)
        self.assertIn("flex-direction:row!important", block)
        self.assertIn("gap:12px!important", block)
        self.assertIn("grid-column:unset!important", block)

    def test_css_title_inside_box(self):
        idx = self.css.find("#sidebarnav .spartan-set-title{")
        self.assertGreater(idx, 0)
        block = self.css[idx : idx + 600]
        self.assertIn("background:#000!important", block)
        self.assertIn("color:#fff!important", block)
        self.assertIn("border-radius:8px!important", block)
        box_idx = self.css.find("#sidebarnav .spartan-set-box{")
        box_block = self.css[box_idx : box_idx + 400]
        self.assertIn("padding:10px 0 12px!important", box_block)

    def test_css_hide_legacy_sound_classes(self):
        v87 = self.css.split("spartan-v87", 1)[1][:3500]
        self.assertIn(".spartan-sound-chat", v87)
        self.assertIn("display:none!important", v87)

    def test_css_equal_height_columns(self):
        v87 = self.css.split("spartan-v87", 1)[1][:3500]
        self.assertIn("align-items:stretch!important", v87)
        self.assertIn("min-height:100%!important", v87)


class SettingsLiveTests(unittest.TestCase):
    """Opcional: valida HTML servido pelo Galene local (8443)."""

    @classmethod
    def setUpClass(cls):
        try:
            import urllib.request

            req = urllib.request.Request(
                "http://127.0.0.1:8443/galene.html",
                headers={"Cache-Control": "no-cache"},
            )
            with urllib.request.urlopen(req, timeout=3) as r:
                cls.live = r.read().decode("utf-8", errors="replace")
            cls.live_ok = True
        except Exception:
            cls.live = ""
            cls.live_ok = False

    def test_live_html_if_server_up(self):
        if not self.live_ok:
            self.skipTest("Galene não está em http://127.0.0.1:8443/")
        self.assertIn("spartan-sounds-setting", self.live)
        self.assertNotIn("Som do chat", self.live)
        self.assertIn("galene-spartan.css?v=98", self.live)


if __name__ == "__main__":
    unittest.main()
