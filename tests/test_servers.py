#!/usr/bin/env python3
"""Servidores do sidecar: modelo, presença agregada, moderador, canais."""
from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(ROOT))
import registry as reg  # noqa: E402


class FakeHandler:
    def __init__(self):
        self.code = None
        self.payload = None

    def send_json(self, code, payload):
        self.code = code
        self.payload = payload


class ServersModelTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self._old = (reg.SERVERS, reg.GROUPS, reg.DATA, reg.SITE, reg.ACCOUNTS)
        self._ia = reg.internal_auth
        reg.internal_auth = lambda: ""
        reg.SERVERS = self.tmp / "servers.json"
        reg.GROUPS = self.tmp / "groups"
        reg.DATA = self.tmp / "registry.json"
        reg.SITE = self.tmp / "site.json"
        reg.ACCOUNTS = self.tmp / "accounts.json"
        reg.GROUPS.mkdir()
        (reg.GROUPS / "spartan.json").write_text(
            json.dumps({
                "displayName": "Spartan",
                "users": {
                    "admin": {"permissions": "op", "password": {"type": "plain", "key": "adminpass"}},
                    "ana": {"permissions": "present", "password": {"type": "plain", "key": "anapass12"}},
                },
            }, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        (reg.GROUPS / "jogo-x.json").write_text(
            json.dumps({"displayName": "Jogo X", "public": True}, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        reg.SITE.write_text(json.dumps({"main": "spartan", "home": "spartan"}) + "\n", encoding="utf-8")
        reg.account_ensure("admin", force_id=0)
        reg.account_set_password("admin", "adminpass", role="op")
        reg.account_ensure("ana")
        reg.account_set_password("ana", "anapass12", role="present")
        reg.account_ensure("bruno")
        reg.account_set_password("bruno", "brunopass", role="present")

    def tearDown(self):
        reg.SERVERS, reg.GROUPS, reg.DATA, reg.SITE, reg.ACCOUNTS = self._old
        reg.internal_auth = self._ia

    def _post(self, path, body):
        h = FakeHandler()
        handled = reg.servers_http_post(h, path, body)
        self.assertTrue(handled)
        return h

    def _get(self, path, q):
        h = FakeHandler()
        handled = reg.servers_http_get(h, path, q)
        self.assertTrue(handled)
        return h

    def test_official_server_preset_and_categories(self):
        doc = reg.ensure_servers()
        s = doc["servers"]["spartan"]
        self.assertTrue(s["official"])
        ids = {c.get("key") or c["id"] for c in s["channels"]}
        self.assertIn("voz-1", ids)
        self.assertIn("voz-2", ids)
        self.assertIn("voz-3", ids)
        self.assertIn("ausentes", ids)
        self.assertIn("geral", ids)
        self.assertTrue(all("__" in c["id"] for c in s["channels"]))
        self.assertNotIn("capturas", ids)
        self.assertIsNone(reg.find_channel(s, "capturas"))
        self.assertNotIn("lobby", ids)
        voz1 = reg.find_channel(s, "voz-1")
        self.assertEqual(voz1["kind"], "voice")
        self.assertEqual(voz1["group"], "spartan")
        self.assertEqual(reg.find_channel(s, "geral")["kind"], "text")
        self.assertEqual(reg.find_channel(s, "geral")["title"], "Chat Geral")
        afk = reg.find_channel(s, "ausentes")
        self.assertTrue(afk.get("afk"))
        self.assertEqual(afk["kind"], "voice")
        cat_ids = {c["id"] for c in s["categories"]}
        self.assertEqual(cat_ids, {"voz", "texto"})
        self.assertTrue(s.get("invite"))

    def test_extra_galene_group_stays_out_of_server_channels(self):
        s = reg.ensure_servers()["servers"]["spartan"]
        groups = {c.get("group") for c in s["channels"] if c.get("kind") == "voice"}
        self.assertNotIn("jogo-x", groups)
        titles = {c["title"] for c in s["channels"]}
        self.assertNotIn("Jogo X", titles)

    def test_server_voice_groups_are_not_extra_ttl_rooms(self):
        s = reg.ensure_servers()["servers"]["spartan"]
        aus = next(c.get("group") for c in s["channels"] if c.get("key") == "ausentes")
        voz2 = next(c.get("group") for c in s["channels"] if c.get("key") == "voz-2")
        self.assertTrue(aus)
        self.assertTrue(reg.is_server_voice_group(aus))
        self.assertTrue(reg.is_server_voice_group(voz2))
        self.assertFalse(reg.is_server_voice_group("spartan"))
        self.assertFalse(reg.is_server_voice_group("jogo-x"))
        d = reg.load()
        b = reg.bucket(d, aus)
        past = (datetime.now(reg.TZ) - timedelta(hours=1)).isoformat(timespec="seconds")
        b["ttl"] = {"created_at": past, "expires_at": past, "kind": "public"}
        reg.save(d)
        reg.strip_server_voice_ttl()
        self.assertFalse((reg.load().get(aus) or {}).get("ttl"))
        reg.ensure_public_ttl()
        self.assertFalse((reg.load().get(aus) or {}).get("ttl"))
        self.assertTrue((reg.load().get("jogo-x") or {}).get("ttl"))
        d = reg.load()
        b = reg.bucket(d, aus)
        b["ttl"] = {"created_at": past, "expires_at": past, "kind": "public"}
        reg.save(d)
        reg.expire_due()
        self.assertTrue((reg.GROUPS / f"{aus}.json").exists())
        self.assertFalse((reg.load().get(aus) or {}).get("ttl"))
        self.assertTrue((reg.GROUPS / "jogo-x.json").exists())

    def test_cannot_delete_official(self):
        h = self._post("/server-delete", {"user": "admin", "password": "adminpass", "server": "spartan"})
        self.assertEqual(h.code, 403)
        self.assertIn("oficial", h.payload["error"])

    def test_create_extra_server_and_invite_join(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        self.assertEqual(h.code, 200)
        sid = h.payload["id"]
        invite = h.payload["invite"]
        s = reg.get_server(sid)
        self.assertFalse(s["official"])
        self.assertEqual(s["owner"], "admin")
        self.assertTrue(any(c["kind"] == "text" for c in s["channels"]))
        self.assertTrue(any((c.get("key") or c["id"]) == "geral" for c in s["channels"]))
        self.assertFalse(any(c["id"] == "capturas" or c.get("key") == "capturas" for c in s["channels"]))
        self.assertTrue(any((c.get("key") or c["id"]) == "voz-1" for c in s["channels"]))
        self.assertTrue(any(c.get("afk") for c in s["channels"]))
        h2 = self._post("/server-join", {"user": "bruno", "password": "brunopass", "invite": invite})
        self.assertEqual(h2.code, 200)
        self.assertEqual(h2.payload["status"], "member")
        s = reg.get_server(sid)
        self.assertEqual((s["members"].get("bruno") or {}).get("role"), "member")
        self.assertNotIn("bruno", s.get("pending") or {})

    def test_moderator_is_sidecar_not_galene_op(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        sid = h.payload["id"]
        invite = h.payload["invite"]
        self._post("/server-join", {"user": "bruno", "password": "brunopass", "invite": invite})
        hm = self._post("/server-mod", {
            "user": "admin", "password": "adminpass", "server": sid, "nick": "bruno", "on": True,
        })
        self.assertEqual(hm.code, 200)
        self.assertEqual(hm.payload["role"], "mod")
        self.assertEqual(hm.payload["galene_perm"], "present")
        s = reg.get_server(sid)
        self.assertEqual(reg.server_member_role(s, "bruno"), "mod")
        self.assertEqual(reg.account_get_role("bruno"), "present")
        hc = self._post("/server-channel", {
            "user": "bruno", "password": "brunopass", "server": sid,
            "title": "Geral da staff", "kind": "text", "category": "texto",
        })
        self.assertEqual(hc.code, 200)
        self.assertEqual(hc.payload["channel"]["kind"], "text")
        self.assertIsNone(hc.payload["channel"].get("group"))

    def test_mod_creates_voice_without_being_galene_admin(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        sid = h.payload["id"]
        self._post("/server-join", {"user": "bruno", "password": "brunopass", "invite": h.payload["invite"]})
        self._post("/server-approve", {"user": "admin", "password": "adminpass", "server": sid, "nick": "bruno"})
        self._post("/server-mod", {"user": "admin", "password": "adminpass", "server": sid, "nick": "bruno", "on": True})
        hv = self._post("/server-channel", {
            "user": "bruno", "password": "brunopass", "server": sid,
            "title": "Jogo Y", "kind": "voice", "category": "jogos",
        })
        self.assertEqual(hv.code, 200)
        ch = hv.payload["channel"]
        self.assertEqual(ch["kind"], "voice")
        self.assertEqual(ch["category"], "voz")
        self.assertTrue(ch.get("group"))
        self.assertTrue((reg.GROUPS / f"{ch['group']}.json").exists())

    def test_voice_channel_limit(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Lotado"})
        sid = h.payload["id"]

        def _fill(d):
            srv = d["servers"][sid]
            for i in range(reg.SERVER_VOICE_LIMIT):
                srv["channels"].append({
                    "id": f"v{i}", "title": f"V{i}", "kind": "voice",
                    "category": "voz", "group": f"g{i}", "public": True,
                })
            return True

        reg.mutate_servers(_fill)
        h2 = self._post("/server-channel", {
            "user": "admin", "password": "adminpass", "server": sid,
            "title": "Mais uma", "kind": "voice",
        })
        self.assertEqual(h2.code, 400)
        self.assertIn("limite", h2.payload["error"])

    def test_presence_voice_wins_over_text(self):
        tnow = datetime.now(reg.TZ)
        iso = tnow.isoformat(timespec="seconds")
        s = reg.ensure_servers()["servers"]["spartan"]
        aus = next(c.get("group") for c in s["channels"] if c.get("key") == "ausentes")
        self.assertTrue(aus)
        reg.save({
            aus: {
                "live": {"users": {"ana": {"last": iso, "since": iso}}},
            },
        })
        s["here"] = {"ana": {"channel": "geral", "at": iso, "kind": "text"},
                     "bruno": {"channel": "geral", "at": iso, "kind": "text"}}
        people = {p["nick"]: p for p in reg.server_presence_people(s)}
        self.assertEqual(people["ana"]["kind"], "voice")
        self.assertEqual(people["ana"]["title"], "Ausentes")
        self.assertEqual(people["bruno"]["kind"], "text")
        self.assertEqual(reg.channel_key(people["bruno"]["channel"], "spartan"), "geral")

    def test_member_cannot_promote_mod(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        sid = h.payload["id"]
        self._post("/server-join", {"user": "bruno", "password": "brunopass", "invite": h.payload["invite"]})
        self._post("/server-approve", {"user": "admin", "password": "adminpass", "server": sid, "nick": "bruno"})
        h2 = self._post("/server-mod", {
            "user": "bruno", "password": "brunopass", "server": sid, "nick": "ana", "on": True,
        })
        self.assertEqual(h2.code, 403)

    def test_get_servers_lists_official_first(self):
        self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        h = self._get("/servers", {"user": ["admin"]})
        self.assertEqual(h.code, 200)
        ids = [s["id"] for s in h.payload["servers"]]
        self.assertEqual(ids[0], "spartan")
        self.assertIn("tardis", ids)
        heads = next(s.get("text_heads") for s in h.payload["servers"] if s["id"] == "spartan")
        self.assertIsInstance(heads, dict)

    def test_get_server_hides_invite(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        sid, invite = h.payload["id"], h.payload["invite"]
        g = self._get("/server", {"id": [sid], "user": ["admin"]})
        self.assertEqual(g.code, 200)
        self.assertNotIn("invite", g.payload)
        self.assertEqual(g.payload.get("pending") or [], [])
        v = self._post("/server-view", {"user": "admin", "password": "adminpass", "server": sid})
        self.assertEqual(v.code, 200)
        self.assertEqual(v.payload.get("invite"), invite)

    def test_guest_creates_account_and_joins(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        invite = h.payload["invite"]
        sid = h.payload["id"]
        g = self._post("/server-guest", {
            "user": "carla", "password": "carlapass", "password2": "carlapass", "invite": invite,
        })
        self.assertEqual(g.code, 200)
        self.assertEqual(g.payload["status"], "member")
        self.assertEqual(g.payload["id"], sid)
        self.assertTrue(reg.account_has_password("carla"))
        s = reg.get_server(sid)
        self.assertEqual((s["members"].get("carla") or {}).get("role"), "member")

    def test_invite_rotate_invalidates_old_and_preview_url(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        old = h.payload["invite"]
        sid = h.payload["id"]
        prev = self._get("/server-invite", {"code": [old]})
        self.assertEqual(prev.code, 200)
        self.assertEqual(prev.payload["id"], sid)
        via_url = self._get("/server-invite", {"code": ["https://exemplo.local/#/i/" + old]})
        self.assertEqual(via_url.code, 200)
        self.assertEqual(via_url.payload["id"], sid)
        rot = self._post("/server-invite-rotate", {"user": "admin", "password": "adminpass", "server": sid})
        self.assertEqual(rot.code, 200)
        new = rot.payload["invite"]
        self.assertTrue(new)
        self.assertNotEqual(new, old)
        dead = self._post("/server-join", {"user": "bruno", "password": "brunopass", "invite": old})
        self.assertEqual(dead.code, 404)
        ok = self._post("/server-join", {"user": "bruno", "password": "brunopass", "invite": "https://exemplo.local/#/i/" + new})
        self.assertEqual(ok.code, 200)
        again = self._post("/server-join", {"user": "bruno", "password": "brunopass", "invite": new})
        self.assertEqual(again.code, 200)
        self.assertEqual(again.payload["status"], "member")

    def test_account_login_home_voice(self):
        h = self._post("/account-login", {"user": "admin", "password": "adminpass"})
        self.assertEqual(h.code, 200)
        self.assertEqual(h.payload["channel"], "geral")
        self.assertEqual(h.payload["home"], "spartan")

    def test_mod_moves_member_to_ausentes(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        sid = h.payload["id"]
        self._post("/server-join", {"user": "bruno", "password": "brunopass", "invite": h.payload["invite"]})
        mv = self._post("/server-move", {
            "user": "admin", "password": "adminpass", "server": sid, "nick": "bruno", "channel": "ausentes",
        })
        self.assertEqual(mv.code, 200)
        self.assertEqual(mv.payload["channel"], "ausentes")
        self.assertTrue(mv.payload.get("afk"))
        view = self._post("/server-view", {"user": "bruno", "password": "brunopass", "server": sid})
        self.assertEqual(view.code, 200)
        self.assertEqual(view.payload.get("my_reloc", {}).get("channel"), "ausentes")
        ack = self._post("/server-moved", {
            "user": "bruno", "password": "brunopass", "server": sid, "channel": "ausentes",
        })
        self.assertEqual(ack.code, 200)
        view2 = self._post("/server-view", {"user": "bruno", "password": "brunopass", "server": sid})
        self.assertIsNone(view2.payload.get("my_reloc"))

    def test_sniff_chat_file_kinds_and_limit(self):
        png = reg.sniff_chat_file(b"\x89PNG\r\n\x1a\nxxxx", "", "print.png")
        self.assertEqual(png[2], "image")
        jpg = reg.sniff_chat_file(b"\xff\xd8\xff\xe0xxxx", "", "print.jpg")
        self.assertEqual(jpg[2], "image")
        mp3 = reg.sniff_chat_file(b"ID3xxxx", "", "som.mp3")
        self.assertEqual(mp3[2], "audio")
        mp4 = reg.sniff_chat_file(b"\x00\x00\x00\x18ftypisom", "", "jogo.mp4")
        self.assertEqual(mp4[2], "video")
        self.assertIsNone(reg.sniff_chat_file(b"%PDF-1.4", "application/pdf", "doc.pdf"))
        self.assertEqual(reg.CHAT_FILE_MAX, 100 * 1024 * 1024)

    def test_servers_voice_ids_and_groups_are_independent(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        self.assertEqual(h.code, 200)
        sid = h.payload["id"]
        main = reg.ensure_servers()["servers"]["spartan"]
        extra = reg.get_server(sid)
        mids = {c["id"] for c in main["channels"]}
        eids = {c["id"] for c in extra["channels"]}
        self.assertFalse(mids & eids)
        self.assertTrue(all(c["id"].startswith("spartan__") for c in main["channels"]))
        self.assertTrue(all(c["id"].startswith(sid + "__") for c in extra["channels"]))
        mgroups = {c.get("group") for c in main["channels"] if c.get("kind") == "voice" and c.get("group")}
        egroups = {c.get("group") for c in extra["channels"] if c.get("kind") == "voice" and c.get("group")}
        self.assertFalse(mgroups & egroups)

    def test_rename_and_delete_channel(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        sid = h.payload["id"]
        created = self._post("/server-channel", {
            "user": "admin", "password": "adminpass", "server": sid,
            "title": "Staff", "kind": "text", "category": "texto",
        })
        self.assertEqual(created.code, 200)
        cid = created.payload["channel"]["id"]
        rn = self._post("/server-channel-rename", {
            "user": "admin", "password": "adminpass", "server": sid,
            "channel": cid, "title": "Sala da staff",
        })
        self.assertEqual(rn.code, 200)
        self.assertEqual(reg.find_channel(reg.get_server(sid), cid)["title"], "Sala da staff")
        rm = self._post("/server-channel-delete", {
            "user": "admin", "password": "adminpass", "server": sid, "channel": cid,
        })
        self.assertEqual(rm.code, 200)
        self.assertIsNone(reg.find_channel(reg.get_server(sid), cid))
        geral = reg.find_channel(reg.get_server(sid), "geral")
        blocked = self._post("/server-channel-delete", {
            "user": "admin", "password": "adminpass", "server": sid, "channel": geral["id"],
        })
        self.assertEqual(blocked.code, 403)

    def test_cannot_delete_official_main_voice(self):
        voz = reg.find_channel(reg.ensure_servers()["servers"]["spartan"], "voz-1")
        h = self._post("/server-channel-delete", {
            "user": "admin", "password": "adminpass", "server": "spartan", "channel": voz["id"],
        })
        self.assertEqual(h.code, 403)


    def test_named_user_needs_membership_even_on_official(self):
        h = self._get("/servers", {"user": ["ana"]})
        self.assertEqual(h.code, 200)
        self.assertEqual(h.payload["servers"], [])
        g = self._get("/server", {"id": ["spartan"], "user": ["ana"]})
        self.assertEqual(g.code, 403)
        empty = self._get("/servers", {})
        self.assertEqual(empty.code, 200)
        self.assertEqual(empty.payload["servers"], [])
        login = self._post("/account-login", {"user": "ana", "password": "anapass12"})
        self.assertEqual(login.code, 200)
        self.assertEqual(login.payload["home"], "")
        self.assertEqual(login.payload["servers"], [])
        self.assertIsNone(login.payload.get("panel_scope"))
        add = self._post("/server-member-add", {
            "user": "admin", "password": "adminpass", "server": "spartan", "nick": "ana",
        })
        self.assertEqual(add.code, 200)
        listed = self._get("/servers", {"user": ["ana"]})
        self.assertEqual([s["id"] for s in listed.payload["servers"]], ["spartan"])
        view = self._get("/server", {"id": ["spartan"], "user": ["ana"]})
        self.assertEqual(view.code, 200)
        rm = self._post("/server-member-remove", {
            "user": "admin", "password": "adminpass", "server": "spartan", "nick": "ana",
        })
        self.assertEqual(rm.code, 200)
        self.assertTrue(rm.payload.get("kicked"))
        gone = self._get("/server", {"id": ["spartan"], "user": ["ana"]})
        self.assertEqual(gone.code, 403)
        s = reg.get_server("spartan")
        self.assertIn("ana", s.get("kicks") or {})
        addable = self._post("/server-addable", {
            "user": "admin", "password": "adminpass", "server": "spartan",
        })
        self.assertEqual(addable.code, 200)
        self.assertIn("ana", addable.payload["users"])
        self.assertNotIn("admin", addable.payload["users"])

    def test_mod_adds_member_but_cannot_promote(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        sid = h.payload["id"]
        self._post("/server-join", {"user": "bruno", "password": "brunopass", "invite": h.payload["invite"]})
        self._post("/server-mod", {"user": "admin", "password": "adminpass", "server": sid, "nick": "bruno", "on": True})
        self.assertEqual(reg.panel_scope_for("bruno", "brunopass"), "mod")
        add = self._post("/server-member-add", {
            "user": "bruno", "password": "brunopass", "server": sid, "nick": "ana",
        })
        self.assertEqual(add.code, 200)
        promo = self._post("/server-mod", {
            "user": "bruno", "password": "brunopass", "server": sid, "nick": "ana", "on": True,
        })
        self.assertEqual(promo.code, 403)
        us = self._post("/user-servers", {"user": "admin", "password": "adminpass", "nick": "ana"})
        self.assertEqual(us.code, 200)
        by = {r["id"]: r for r in us.payload["servers"]}
        self.assertTrue(by[sid]["has"])
        self.assertFalse(by["spartan"]["has"])
        deny = self._post("/user-servers", {"user": "bruno", "password": "brunopass", "nick": "ana"})
        self.assertEqual(deny.code, 403)

    def test_admin_login_panel_scope(self):
        h = self._post("/account-login", {"user": "admin", "password": "adminpass"})
        self.assertEqual(h.code, 200)
        self.assertEqual(h.payload["panel_scope"], "admin")
        self.assertEqual(h.payload["home"], "spartan")
        self.assertFalse(h.payload.get("must_change"))

    def test_account_login_must_change_flag(self):
        d = reg.load_accounts()
        uid = d["by_nick"]["admin"]
        d["by_id"][str(uid)]["must_change"] = True
        reg.save_accounts(d)
        h = self._post("/account-login", {"user": "admin", "password": "adminpass"})
        self.assertEqual(h.code, 200)
        self.assertTrue(h.payload.get("must_change"))

    def test_cannot_delete_preset_text_and_afk(self):
        s = reg.ensure_servers()["servers"]["spartan"]
        geral = reg.find_channel(s, "geral")
        afk = reg.find_channel(s, "ausentes")
        h1 = self._post("/server-channel-delete", {
            "user": "admin", "password": "adminpass", "server": "spartan", "channel": geral["id"],
        })
        self.assertEqual(h1.code, 403)
        h2 = self._post("/server-channel-delete", {
            "user": "admin", "password": "adminpass", "server": "spartan", "channel": afk["id"],
        })
        self.assertEqual(h2.code, 403)
        view = reg.server_public_view(s, "admin")
        by = {c.get("key"): c for c in view["channels"]}
        self.assertTrue(by["geral"]["locked"])
        self.assertTrue(by["voz-1"]["locked"])
        self.assertTrue(by["ausentes"]["locked"])
        self.assertTrue(by["ausentes"]["afk"])
        self.assertFalse(by["voz-2"]["locked"])

    def test_rename_ausentes_keeps_afk_id(self):
        s = reg.ensure_servers()["servers"]["spartan"]
        afk = reg.find_channel(s, "ausentes")
        h = self._post("/server-channel-rename", {
            "user": "admin", "password": "adminpass", "server": "spartan",
            "channel": afk["id"], "title": "Descanso",
        })
        self.assertEqual(h.code, 200)
        again = reg.find_channel(reg.get_server("spartan"), "ausentes")
        self.assertEqual(again["title"], "Descanso")
        self.assertEqual(again.get("key"), "ausentes")
        self.assertTrue(again.get("afk"))
        self.assertTrue(reg.channel_is_locked(again, "spartan"))
        # ensure_servers nao devolve o titulo de fabrica
        kept = reg.find_channel(reg.ensure_servers()["servers"]["spartan"], "ausentes")
        self.assertEqual(kept["title"], "Descanso")

    def test_reorder_voice_channels(self):
        s = reg.ensure_servers()["servers"]["spartan"]
        ids = [c["id"] for c in s["channels"] if c.get("kind") == "voice"]
        self.assertGreaterEqual(len(ids), 4)
        new = list(reversed(ids))
        texts = [c["id"] for c in s["channels"] if c.get("kind") == "text"]
        h = self._post("/server-channel-reorder", {
            "user": "admin", "password": "adminpass", "server": "spartan",
            "order": texts + new,
        })
        self.assertEqual(h.code, 200)
        after = [c["id"] for c in reg.get_server("spartan")["channels"] if c.get("kind") == "voice"]
        self.assertEqual(after, new)

    def test_reorder_keeps_text_above_voice(self):
        s = reg.ensure_servers()["servers"]["spartan"]
        voices = [c["id"] for c in s["channels"] if c.get("kind") != "text"]
        texts = [c["id"] for c in s["channels"] if c.get("kind") == "text"]
        self.assertTrue(texts and voices)
        h = self._post("/server-channel-reorder", {
            "user": "admin", "password": "adminpass", "server": "spartan",
            "order": voices + texts,
        })
        self.assertEqual(h.code, 200)
        kinds = [c.get("kind") for c in reg.get_server("spartan")["channels"]]
        last_text = max(i for i, k in enumerate(kinds) if k == "text")
        first_voice = min(i for i, k in enumerate(kinds) if k != "text")
        self.assertLess(last_text, first_voice)

    def test_factory_password_marks_must_change(self):
        self.assertTrue(reg.account_set_password("carla", "Mudar@123", role="present"))
        rec = reg.account_get("carla")
        self.assertTrue(rec.get("must_change"))
        self.assertTrue(reg.account_verify_password("carla", "Mudar@123"))
        rec_ana = reg.account_get("ana")
        self.assertFalse(bool(rec_ana.get("must_change")))

    def test_deleted_extra_voice_stays_deleted(self):
        h = self._post("/server-create", {"user": "admin", "password": "adminpass", "title": "Tardis"})
        sid = h.payload["id"]
        voz2 = reg.find_channel(reg.get_server(sid), "voz-2")
        self.assertIsNotNone(voz2)
        rm = self._post("/server-channel-delete", {
            "user": "admin", "password": "adminpass", "server": sid, "channel": voz2["id"],
        })
        self.assertEqual(rm.code, 200)
        self.assertIsNone(reg.find_channel(reg.get_server(sid), "voz-2"))

    def test_registered_nicks_include_galene_user_never_logged(self):
        g = json.loads((reg.GROUPS / "spartan.json").read_text(encoding="utf-8"))
        g.setdefault("users", {})["dora"] = {"permissions": "present"}
        (reg.GROUPS / "spartan.json").write_text(json.dumps(g, ensure_ascii=False) + "\n", encoding="utf-8")
        self.assertIn("dora", reg.list_registered_nicks())
        addable = self._post("/server-addable", {
            "user": "admin", "password": "adminpass", "server": "spartan",
        })
        self.assertEqual(addable.code, 200)
        self.assertIn("dora", addable.payload["users"])


class ServersUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        cls.shell = (ROOT / "static" / "spartan-shell.js").read_text(encoding="utf-8")
        cls.css = (ROOT / "static" / "spartan-shell.css").read_text(encoding="utf-8")
        cls.roomcss = (ROOT / "static" / "galene-spartan.css").read_text(encoding="utf-8")
        cls.admin = (ROOT / "static" / "admin" / "index.html").read_text(encoding="utf-8")
        cls.galene = (ROOT / "static" / "galene.js").read_text(encoding="utf-8")

    def test_shell_hash_server_and_rails(self):
        self.assertIn('id="spartan-guild-rail"', self.index)
        self.assertIn('id="spartan-channel-rail"', self.index)
        self.assertIn('id="spartan-server-people"', self.index)
        self.assertIn('id="spartan-text-pane"', self.index)
        self.assertIn("#/s/", self.shell)
        self.assertIn("goServer", self.shell)
        self.assertIn("spartan-servers.js?v=19", self.index)
        self.assertIn("spartan-shell.js?v=8", self.index)
        self.assertIn("spartan-shell.css?v=26", self.index)
        self.assertIn('id="spartan-login-form"', self.index)
        self.assertIn("#/convidado", self.index)
        self.assertIn("#/i/", self.shell)
        self.assertIn('id="spartan-invite-ask"', self.index)
        self.assertIn('id="spartan-shell-admin" hidden', self.index)
        self.assertIn("html.spartan-in-shell #left-sidebar", self.roomcss)
        self.assertIn("html.spartan-in-shell #header", self.roomcss)
        self.assertIn("html.spartan-in-shell .header-title", self.roomcss)
        self.assertIn("spartan-talk-dot", self.css)
        self.assertIn("#spartan-text-pane", self.css)
        self.assertIn("position: absolute", self.css)
        self.assertIn("spartan-people-collapsed", self.index)
        self.assertIn('id="spartan-people-strip"', self.index)
        self.assertIn('id="spartan-text-show"', self.index)
        self.assertNotIn('id="spartan-text-badge"', self.index)
        self.assertIn("Não abrir sozinho", self.index)
        self.assertIn("width: max-content", self.css)
        self.assertIn("#eab308", self.css)

    def test_text_does_not_swap_iframe(self):
        js = (ROOT / "static" / "spartan-servers.js").read_text(encoding="utf-8")
        self.assertIn("function showText(ch)", js)
        show = js.split("function showText(ch)", 1)[1].split("function pickChannel", 1)[0]
        self.assertNotIn("setFrame(", show)
        self.assertIn("if(frame.getAttribute('src') !== src)", js)
        self.assertIn("&afk=1", js)
        self.assertIn("function applyTextHeads", js)
        self.assertIn("updateChatFab", js)
        self.assertIn("spartanServerMute", js)
        self.assertIn("Não abrir sozinho", js)

    def test_grid_functions_untouched(self):
        self.assertIn("function resizePeers", self.galene)
        self.assertIn("function showHideMedia", self.galene)
        self.assertIn("function gotDownStream", self.galene)

    def test_user_bar_and_no_create_channel_in_rail(self):
        js = (ROOT / "static" / "spartan-servers.js").read_text(encoding="utf-8")
        paint = js.split("function paintChannels()", 1)[1].split("function paintModTools", 1)[0]
        self.assertNotIn("paintModTools", paint)
        self.assertNotIn("Criar canal", paint)
        self.assertIn('id="spartan-user-bar"', self.index)
        self.assertIn('id="spartan-user-mic"', self.index)
        self.assertIn('id="spartan-user-share"', self.index)
        self.assertIn('id="spartan-user-settings"', self.index)
        self.assertIn('id="spartan-first-modal"', self.index)
        self.assertIn('id="spartan-shell-settings"', self.index)
        self.assertIn("openShellSettings", js)
        openSet = js.split("function openSettings()", 1)[1].split("function closeShellSettings", 1)[0]
        self.assertNotIn("openAdmin", openSet)
        self.assertIn("spartan-shell-cmd", js)
        self.assertNotIn("Conectado em ", js)
        self.assertIn("spartan-shell-cmd", self.galene)
        self.assertIn('id="spartan-user-leave"', self.index)
        self.assertIn("spartan-talk-dot", js)
        self.assertIn("spartanNotifyShellTalk", self.galene)
        self.assertIn("chanKey", js)
        self.assertIn("s.id === current.server", js)
        apply = js.split("function applyChannel(ch)", 1)[1].split("function openServer", 1)[0]
        self.assertNotIn("if(!current.voice)", apply)
        self.assertIn("chanKey(c) === 'geral'", js)
        self.assertNotIn("spartan-chan-grip", paint)
        self.assertNotIn("function reorderLiveChan", js)
        self.assertIn("/first-password", (ROOT / "static" / "custom-home.js").read_text(encoding="utf-8"))
        self.assertIn("spartan-text-open", js)
        self.assertIn("detail.roster", js)
        self.assertNotIn('"id":"capturas"', (ROOT / "registry.py").read_text(encoding="utf-8"))
        self.assertIn('id="spartan-user-cam"', self.index)
        self.assertNotIn('id="spartan-user-hideown"', self.index)
        self.assertIn('id="spartan-text-attach"', self.index)
        self.assertIn("spartan-people-card", js)
        self.assertIn("spartan-people-card", self.css)
        self.assertIn("uploadChatFile", js)
        self.assertIn("server-file", js)
        self.assertIn("spartan-roster", js)
        self.assertIn("user-live-btn", js)
        self.assertIn("volOpenNick", js)
        self.assertIn("scrollTextToLatest", js)
        self.assertIn("mute-both", js)
        extras = js.split("function paintUserExtras(who)", 1)[1].split("function applyRoster", 1)[0]
        self.assertIn("volOpenNick === nick", extras)
        self.assertIn("mute-local", extras)
        self.assertIn("spartan-chan-ident", extras)
        self.assertIn("#spartan-text-log", self.css)
        self.assertIn("min-height: 0", self.css.split("#spartan-text-log", 1)[1][:180])
        self.assertIn("mute-both", self.css)
        self.assertIn("#eab308", self.css.split(".spartan-chan-ident .user-mute-btn.mute-local", 1)[1][:80])
        self.assertIn("cmd === 'camera'", self.galene)
        self.assertNotIn("cmd === 'hideown'", self.galene)

    def test_voice_switch_confirms_when_live(self):
        js = (ROOT / "static" / "spartan-servers.js").read_text(encoding="utf-8")
        self.assertIn("function liveBusy()", js)
        self.assertIn("mediaState.share || mediaState.cam", js)
        self.assertIn("lv.on && !lv.up", js)
        pick = js.split("function pickChannel(ch)", 1)[1].split("function hideTextPane", 1)[0]
        self.assertIn("liveBusy()", pick)
        self.assertIn("current.voiceGroup", pick)
        self.assertIn("askSwitchVoice", pick)
        self.assertNotIn("window.confirm", pick)
        self.assertIn("function askSwitchVoice(ch)", js)
        self.assertIn('id="spartan-switch-ask"', self.index)
        self.assertIn('id="spartan-switch-stay"', self.index)
        self.assertIn('id="spartan-switch-go"', self.index)
        self.assertIn("#spartan-switch-ask", self.css)
        self.assertIn("font-size: 1.65rem", self.css)
        apply = js.split("function applyChannel(ch)", 1)[1].split("function openServer", 1)[0]
        self.assertNotIn("window.confirm", apply)
        reloc = js.split("function applyReloc(d)", 1)[1].split("function ackMoved", 1)[0]
        self.assertNotIn("window.confirm", reloc)

    def test_people_list_compact_row(self):
        js = (ROOT / "static" / "spartan-servers.js").read_text(encoding="utf-8")
        people = js.split("function paintPeople()", 1)[1].split("function moveUser", 1)[0]
        self.assertIn("spartan-people-av", people)
        self.assertNotIn("meta.textContent", people)
        self.assertNotIn("roleLabel", people)
        card = self.css.split(".spartan-people-card {", 1)[1].split(".spartan-people-av {", 1)[0]
        self.assertIn("flex-direction: row", card)
        self.assertNotIn("flex-direction: column", card)

    def test_admin_servers_tab(self):
        self.assertIn('data-tab="servers"', self.admin)
        self.assertIn('id="tab-servers"', self.admin)
        self.assertIn("admin.js?v=50", self.admin)
        self.assertIn("admin.css?v=35", self.admin)
        js = (ROOT / "static" / "admin.js").read_text(encoding="utf-8")
        self.assertIn("server-cols", js)
        self.assertIn("Salas de texto", js)
        self.assertIn("Salas de voz", js)
        self.assertIn("server-chan-grip", js)
        self.assertIn("/server-channel-reorder", js)
        self.assertIn("loadServers._k", js)
        self.assertIn("/server-channel-rename", js)
        self.assertIn("/server-channel-delete", js)
        admin_css = (ROOT / "static" / "admin.css").read_text(encoding="utf-8")
        self.assertIn("server-cols", admin_css)
        servers_js = (ROOT / "static" / "spartan-servers.js").read_text(encoding="utf-8")
        open_fn = servers_js.split("function openServer(sid, cid, groupHint)", 1)[1].split("apiGet('/server?id='", 1)[0]
        self.assertNotIn("about:blank", open_fn)
        self.assertNotIn("current.voice = null", open_fn)
        self.assertIn("voiceServer", servers_js)
        self.assertIn("function openSettings()", servers_js)
        self.assertIn("hideTextPane()", servers_js.split("function openSettings()", 1)[1].split("function paintUserBar", 1)[0])
        self.assertIn("openAdmin", servers_js.split("function openSettings()", 1)[1].split("function paintUserBar", 1)[0])
        self.assertIn("spartan-settings-up", self.css)
        self.assertIn("spartan-settings", (ROOT / "static" / "galene.js").read_text(encoding="utf-8"))
        self.assertNotIn("window.confirm", servers_js)
        self.assertIn('id="spartan-leave-ask"', self.index)
        self.assertIn("function doLogout()", servers_js)
        self.assertIn("margin: 0.6rem auto 0", self.css)
        self.assertIn("/server-member-add", js)
        self.assertIn("openMemDlg", js)
        self.assertIn("Adicionar e remover usuários", js)
        self.assertIn("z-index:120", (ROOT / "static" / "admin.css").read_text(encoding="utf-8"))
        self.assertIn("openUserServers", js)
        self.assertIn('id="mem-dlg"', self.admin)
        self.assertIn("panel-mod", (ROOT / "static" / "admin.css").read_text(encoding="utf-8"))
        self.assertIn("dropServer", servers_js)
        self.assertIn("panel_scope", (ROOT / "static" / "custom-home.js").read_text(encoding="utf-8"))
        self.assertIn("handleInvite", servers_js)
        self.assertIn("scope === 'admin'", servers_js)
        self.assertIn("Trocar link", js)
        self.assertIn("/#/i/", js)
        self.assertIn("j.scope==='admin'", (ROOT / "static" / "galene.js").read_text(encoding="utf-8"))

    def test_create_user_nick_only_roles(self):
        self.assertNotIn('id="np"', self.admin)
        self.assertIn(">Usuário</option>", self.admin)
        self.assertNotIn("Ouvinte", self.admin)
        self.assertNotIn("Verificado", self.admin)
        js = (ROOT / "static" / "admin.js").read_text(encoding="utf-8")
        self.assertIn('l:"Usuário"', js)
        self.assertNotIn('l:"Ouvinte"', js)
        self.assertIn("/quick", js)
        self.assertIn("/reset-factory-password", js)
        self.assertIn("server-chan-grip", js)


if __name__ == "__main__":
    unittest.main()
