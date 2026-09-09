#!/usr/bin/env python3
"""Botões Câmera/Tela: só com vídeo/tela real; mic = bolinha."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "static" / "galene.js"


class LiveButtonsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = JS.read_text(encoding="utf-8")

    def test_stream_shows_live_btn_no_camlive_fallback(self):
        m = re.search(
            r"function spartanStreamShowsLiveBtn\(c\) \{.*?^}",
            self.js,
            re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(m)
        body = m.group(0)
        self.assertIn("screenshare", body)
        self.assertIn("streamHasRealVideo", body)
        self.assertNotIn("spartanRemoteCamLive", body)

    def test_snapshot_distinguishes_mic_only(self):
        m = re.search(
            r"function spartanSnapshotMediaState\(\) \{.*?^}",
            self.js,
            re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(m)
        body = m.group(0)
        self.assertIn("hadMicOnly", body)
        self.assertIn("streamHasRealVideo", body)
        self.assertIn("hadCamera", body)

    def test_republish_respects_audio_only(self):
        m = re.search(
            r"async function spartanRepublishUps\(keep\) \{.*?^}",
            self.js,
            re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(m)
        body = m.group(0)
        self.assertIn("audioOnly", body)
        self.assertIn("!snap.hadCamera", body)
        self.assertNotRegex(
            body,
            r"addLocalMedia\(undefined,\s*false\)",
        )


class ReconnectMediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = JS.read_text(encoding="utf-8")

    def test_recovering_flag_on_silent_reconnect(self):
        self.assertIn("_spartanRecoveringMedia = true", self.js)

    def test_got_joined_recover_skips_force_mute(self):
        m = re.search(
            r"async function gotJoined\(.*?\n\}",
            self.js,
            re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(m)
        body = m.group(0)
        self.assertIn("spartanRestoreMediaAfterReconnect(mediaSnap)", body)
        self.assertIn("if(recovering)", body)
        # Mute forçado só no else de recovering — nunca no ramo recover.
        self.assertRegex(
            body,
            r"if\(recovering\)\s*\{[^}]*spartanRestoreMediaAfterReconnect\(mediaSnap\);[^}]*\}\s*else\s*\{\s*setLocalMute\(true,\s*true\);",
        )
        # Reopen mic-só/câmera no recover não chama setLocalMute(true
        reopen = body.find("mediaSnap.hadMicOnly")
        self.assertGreater(reopen, 0)
        after = body[reopen:]
        force_in_reopen = after.find("setLocalMute(true, true)")
        # O único setLocalMute(true no restante é do present (não recovering)
        self.assertIn("else if(present)", after)

    def test_recover_reopen_uses_audio_only_when_mic_only(self):
        self.assertIn("mediaSnap.hadMicOnly", self.js)
        self.assertIn("addLocalMedia(undefined, !mediaSnap.hadCamera)", self.js)


class ScreenShareSoundTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = JS.read_text(encoding="utf-8")

    def test_unwatched_screenshare_requests_nothing(self):
        m = re.search(
            r"function spartanApplyDownRequest\(c\) \{.*?^}",
            self.js,
            re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(m)
        body = m.group(0)
        self.assertIn("c.label === 'screenshare'", body)
        self.assertIn("c.request([])", body)
        self.assertIn("wantSound ? ['audio', 'video'] : ['video']", body)
        self.assertIn("spartanReleaseUnwatchedVideo(c)", body)
        self.assertNotIn("video-low", body)

    def test_close_live_does_not_use_connection_wide_video(self):
        self.assertIn("function spartanDefaultDownRequest()", self.js)
        self.assertIn("screenshare: []", self.js)
        self.assertIn("this.request(spartanDefaultDownRequest())", self.js)
        self.assertNotIn("this.request({'': ['audio', 'video']})", self.js)
        self.assertIn("function spartanReleaseUnwatchedVideo(c)", self.js)
        self.assertIn("let spartanLiveSound = {}", self.js)
        self.assertIn("window._spartanSoundSnap = spartanSnapshotLiveSound()", self.js)
        self.assertIn("spartanMaybeRestoreLiveSound(c)", self.js)
        self.assertIn("media.muted = true", self.js)
        self.assertIn("spartanReapplyAllLiveSound", self.js)
        self.assertIn("visibilitychange", self.js)

    def test_volume_click_uses_closest_not_classlist_on_target(self):
        m = re.search(
            r"volume\.onclick = function\(event\) \{.*?^\s{8}\};",
            self.js,
            re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(m)
        body = m.group(0)
        self.assertIn("closest('.volume-mute')", body)
        self.assertIn("closest('.volume-slider')", body)
        self.assertNotIn("target.classList.contains('volume-mute')", body)
        self.assertIn("spartanLiveSound[key]", body)


if __name__ == "__main__":
    unittest.main()
