#!/usr/bin/env python3
"""Presença: timer da sala (servidor) e timer individual (servidor)."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(ROOT))
import registry as reg  # noqa: E402

TZ = reg.TZ
presence_heartbeat = reg.presence_heartbeat
presence_leave = reg.presence_leave
room_live_seconds = reg.room_live_seconds
user_live_seconds = reg.user_live_seconds
PRESENCE_ROOM_EMPTY_GRACE_S = reg.PRESENCE_ROOM_EMPTY_GRACE_S
PRESENCE_USER_GRACE_S = reg.PRESENCE_USER_GRACE_S


class PresenceLogicTests(unittest.TestCase):
    def test_room_timer_starts_at_zero_with_first_user(self):
        b = {}
        t0 = datetime.now(TZ)
        presence_heartbeat(b, "alice", t0)
        ls, active = room_live_seconds(b, t0)
        self.assertTrue(active)
        self.assertLessEqual(ls, 1)

    def test_room_timer_grows_while_occupied(self):
        b = {}
        t0 = datetime.now(TZ)
        presence_heartbeat(b, "alice", t0)
        presence_heartbeat(b, "alice", t0 + timedelta(seconds=20))
        presence_heartbeat(b, "alice", t0 + timedelta(seconds=40))
        ls, active = room_live_seconds(b, t0 + timedelta(seconds=50))
        self.assertTrue(active)
        self.assertGreaterEqual(ls, 50)

    def test_room_keeps_counting_while_empty_under_grace(self):
        b = {}
        t0 = datetime.now(TZ)
        presence_heartbeat(b, "alice", t0)
        presence_leave(b, "alice", t0 + timedelta(seconds=40))
        ls, active = room_live_seconds(b, t0 + timedelta(seconds=50))
        self.assertTrue(active)
        self.assertGreaterEqual(ls, 50)

    def test_room_resets_after_empty_grace(self):
        b = {}
        t0 = datetime.now(TZ)
        presence_heartbeat(b, "alice", t0)
        presence_leave(b, "alice", t0 + timedelta(seconds=20))
        after = t0 + timedelta(seconds=20 + PRESENCE_ROOM_EMPTY_GRACE_S + 5)
        ls, active = room_live_seconds(b, after)
        self.assertFalse(active)
        self.assertEqual(ls, 0)
        presence_heartbeat(b, "bob", after + timedelta(seconds=1))
        ls2, active2 = room_live_seconds(b, after + timedelta(seconds=3))
        self.assertTrue(active2)
        self.assertLess(ls2, 5)

    def test_rejoin_within_grace_keeps_counting_empty_gap(self):
        b = {}
        t0 = datetime.now(TZ)
        presence_heartbeat(b, "alice", t0)
        presence_leave(b, "alice", t0 + timedelta(seconds=30))
        presence_heartbeat(b, "alice", t0 + timedelta(seconds=50))
        ls, active = room_live_seconds(b, t0 + timedelta(seconds=70))
        self.assertTrue(active)
        # 70s contínuos (os 20s vazios entram na graça de 5 min)
        self.assertGreaterEqual(ls, 65)
        self.assertLess(ls, 80)

    def test_stale_tick_does_not_inflate_on_join(self):
        t0 = datetime.now(TZ)
        old = (t0 - timedelta(hours=15)).isoformat(timespec="seconds")
        b = {"live": {"room_tick_since": old, "room_accum_s": 54000, "users": {}}}
        presence_heartbeat(b, "alice", t0)
        ls, active = room_live_seconds(b, t0)
        self.assertTrue(active)
        self.assertLess(ls, 5)

    def test_empty_grace_is_five_minutes(self):
        self.assertEqual(PRESENCE_ROOM_EMPTY_GRACE_S, 300)

    def test_user_timer_independent_of_room(self):
        b = {}
        t0 = datetime.now(TZ)
        presence_heartbeat(b, "alice", t0)
        presence_heartbeat(b, "bob", t0 + timedelta(seconds=60))
        ua, _, _ = user_live_seconds(b, "alice", t0 + timedelta(seconds=90))
        ub, _, _ = user_live_seconds(b, "bob", t0 + timedelta(seconds=90))
        self.assertGreaterEqual(ua, 90)
        self.assertLess(ub, 35)

    def test_user_timer_resets_after_grace(self):
        b = {}
        t0 = datetime.now(TZ)
        presence_heartbeat(b, "alice", t0)
        presence_leave(b, "alice", t0 + timedelta(seconds=10))
        later = t0 + timedelta(seconds=10 + PRESENCE_USER_GRACE_S + 5)
        presence_heartbeat(b, "alice", later)
        ls, active, online = user_live_seconds(b, "alice", later + timedelta(seconds=2))
        self.assertTrue(active)
        self.assertTrue(online)
        self.assertLess(ls, 5)

    def test_api_paths_exist(self):
        regtxt = (ROOT / "registry.py").read_text(encoding="utf-8")
        self.assertIn("/presence-room", regtxt)
        self.assertIn("PRESENCE_ROOM_EMPTY_GRACE_S", regtxt)
        js = (ROOT / "static" / "galene.js").read_text(encoding="utf-8")
        self.assertIn("room_live_s", js)
        self.assertIn("user_live_s", js)
        self.assertIn("pagehide", js)
        self.assertIn("sendBeacon", js)


if __name__ == "__main__":
    unittest.main()
