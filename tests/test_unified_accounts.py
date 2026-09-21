#!/usr/bin/env python3
"""Contas unificadas: ID sempre, desativação preserva ID, sem tipos misturados."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


class UnifiedAccountsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.groups = base / "groups"
        self.data = base / "data"
        self.groups.mkdir()
        self.data.mkdir()
        (self.groups / "spartan.json").write_text(
            json.dumps({"displayName": "Spartan", "users": {"admin": {"permissions": "op"}}}, indent=2)
            + "\n",
            encoding="utf-8",
        )
        (self.data / "site.json").write_text(
            json.dumps({"main": "spartan", "home": "spartan"}) + "\n", encoding="utf-8"
        )
        self.env = {
            "DATA": str(self.data / "registry.json"),
            "GROUPS": str(self.groups),
            "SITE": str(self.data / "site.json"),
            "ACCOUNTS": str(self.data / "accounts.json"),
            "SERVERS": str(self.data / "servers.json"),
        }
        # registry.py uses module-level Path constants — patch after import
        import importlib
        import sys

        if "registry" in sys.modules:
            del sys.modules["registry"]
        self.patches = [
            mock.patch.dict(os.environ, {}, clear=False),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

        import registry as reg

        self.reg = reg
        reg.DATA = Path(self.env["DATA"])
        reg.GROUPS = Path(self.env["GROUPS"])
        reg.SITE = Path(self.env["SITE"])
        reg.ACCOUNTS = Path(self.env["ACCOUNTS"])
        reg.SERVERS = Path(self.env["SERVERS"])
        reg.ACCESS_LOG = self.data / "access.log"
        reg.NET_LOG = self.data / "net.log"
        reg.account_ensure("admin", force_id=0)

    def test_panel_assigns_id_to_server_only_member(self):
        doc = {"servers": {
            "clan": {
                "id": "clan", "title": "Clan", "official": False, "owner": "admin",
                "members": {"jorge": {"role": "member", "joined": "2026-01-01T00:00:00"}},
                "mods": [], "pending": {}, "here": {}, "channels": [],
            }
        }}
        self.reg.SERVERS.write_text(json.dumps(doc), encoding="utf-8")
        rows = self.reg.accounts_panel_users()
        by = {r["nick"]: r for r in rows}
        self.assertIn("jorge", by)
        self.assertIsNotNone(by["jorge"]["id"])
        self.assertIn("Clan", by["jorge"]["servers"])
        # sem aviso de tipo — só campos unificados
        self.assertNotIn("kind", by["jorge"])
        self.assertNotIn("inMain", by["jorge"])

    def test_deactivate_keeps_id_forever(self):
        uid = self.reg.account_ensure("jorge")
        self.assertEqual(uid, 1)
        ok, got = self.reg.account_deactivate("jorge")
        self.assertTrue(ok)
        self.assertEqual(got, 1)
        self.assertIsNone(self.reg.account_get("jorge"))
        nicks = self.reg.list_registered_nicks()
        self.assertNotIn("jorge", nicks)
        d = self.reg.load_accounts()
        self.assertIn("1", d["by_id"])
        self.assertFalse(d["by_id"]["1"].get("active", True))
        self.assertEqual(d["by_nick"].get("jorge"), 1)
        # novo usuário NÃO reaproveita o ID 1
        uid2 = self.reg.account_ensure("maria")
        self.assertEqual(uid2, 2)
        self.assertNotEqual(uid2, 1)
        self.assertFalse(self.reg.account_set_password("jorge", "Mudar@123"))

    def test_admin_id0_cannot_deactivate(self):
        ok, err = self.reg.account_deactivate("admin")
        self.assertFalse(ok)
        self.assertIn("admin", err)


if __name__ == "__main__":
    unittest.main()
