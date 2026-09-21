#!/usr/bin/env python3
"""Regressão: is_open não pode ser sombreado em do_GET (UnboundLocalError)."""
from __future__ import annotations

import ast
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(ROOT))
import registry as reg  # noqa: E402


class RegistryScopeTests(unittest.TestCase):
    def test_do_get_does_not_assign_is_open(self):
        src = (ROOT / "registry.py").read_text(encoding="utf-8")
        tree = ast.parse(src)
        do_get = None
        for node in tree.body:
            if isinstance(node, ast.ClassDef) and node.name == "H":
                for item in node.body:
                    if isinstance(item, ast.FunctionDef) and item.name == "do_GET":
                        do_get = item
                        break
        self.assertIsNotNone(do_get)
        assigned = set()
        for n in ast.walk(do_get):
            if isinstance(n, ast.Assign):
                for t in n.targets:
                    if isinstance(t, ast.Name):
                        assigned.add(t.id)
            elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
                assigned.add(n.target.id)
        self.assertNotIn("is_open", assigned)
        self.assertIn("is_room_open", assigned)

    def test_temp_status_after_rooms_source_uses_function(self):
        src = (ROOT / "registry.py").read_text(encoding="utf-8")
        # /rooms usa variável local; /temp-status chama a função global
        self.assertIn("is_room_open=(not pw)", src)
        self.assertIn('out={"open":is_open(g)', src)

    def test_is_open_callable_with_temp_group(self):
        tmp = Path(tempfile.mkdtemp())
        old = (reg.GROUPS, reg.DATA, reg.SITE)
        try:
            reg.GROUPS = tmp / "groups"
            reg.DATA = tmp / "registry.json"
            reg.SITE = tmp / "site.json"
            reg.GROUPS.mkdir()
            (reg.GROUPS / "spartan.json").write_text(
                '{"displayName":"Spartan","users":{"admin":{"permissions":"op"}},'
                '"wildcard-user":{"password":{"type":"pbkdf2","hash":"sha-256","key":"a","salt":"b","iterations":1}}}\n',
                encoding="utf-8",
            )
            reg.SITE.write_text('{"main":"spartan","home":"spartan"}\n', encoding="utf-8")
            reg.DATA.write_text("{}\n", encoding="utf-8")
            self.assertFalse(reg.is_open("spartan"))
            (reg.GROUPS / "livre.json").write_text(
                '{"displayName":"Livre","wildcard-user":{"password":{"type":"wildcard"}}}\n',
                encoding="utf-8",
            )
            self.assertTrue(reg.is_open("livre"))
        finally:
            reg.GROUPS, reg.DATA, reg.SITE = old


class MicConstraintsExportTests(unittest.TestCase):
    def test_window_export(self):
        net = (ROOT / "static" / "spartan-net.js").read_text(encoding="utf-8")
        self.assertIn("window.spartanMicConstraints = spartanMicConstraints", net)
        html = (ROOT / "static" / "galene.html").read_text(encoding="utf-8")
        self.assertIn("spartan-net.js?v=2", html)


if __name__ == "__main__":
    unittest.main()
