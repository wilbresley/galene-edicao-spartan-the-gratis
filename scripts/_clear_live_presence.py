#!/usr/bin/env python3
"""Limpa estado live antigo em registry.json (timers de ocupação)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# No container o registry vive em /data; no host em data/.
CANDIDATES = [Path("/data/registry.json"), ROOT / "data" / "registry.json"]


def main() -> None:
    DATA = next((p for p in CANDIDATES if p.exists()), None)
    if not DATA:
        print("sem registry.json")
        return
    d = json.loads(DATA.read_text(encoding="utf-8"))
    n = 0
    for gid, b in list(d.items()):
        if isinstance(b, dict) and "live" in b:
            b.pop("live", None)
            n += 1
            print("limpo:", gid)
    if n:
        DATA.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("ok", n, str(DATA))


if __name__ == "__main__":
    main()
