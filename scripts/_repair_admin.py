#!/usr/bin/env python3
"""Diagnose and repair admin op in spartan group."""
import base64
import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUTH = (ROOT / "data/sidecar.auth").read_text(encoding="utf-8").strip()
B64 = base64.b64encode(AUTH.encode()).decode()
HDR = {"Authorization": f"Basic {B64}"}
BASE = "http://127.0.0.1:8443/galene-api/v0"


def http(method, path, body=None, ctype="application/json"):
    data = None if body is None else (body if isinstance(body, bytes) else body.encode())
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={**HDR, **({"Content-Type": ctype} if data is not None else {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def main():
    g = json.loads((ROOT / "groups/spartan.json").read_text(encoding="utf-8"))
    print("disk admin perm:", g["users"]["admin"].get("permissions"))

    code, body = http("GET", "/.groups/")
    print("GET /.groups/ ->", code, body[:200])

    code, body = http("GET", "/.groups/spartan/.users/")
    print("GET users list ->", code, body[:300])

    for path in [
        "/.groups/spartan/.users/admin",
        "/.groups/spartan/.wildcard-user",
    ]:
        code, body = http("GET", path)
        print(f"GET {path} ->", code, body[:300])

    # Ensure admin exists with op in Galene runtime
    code, body = http("PUT", "/.groups/spartan/.users/admin", '{"permissions":"op"}')
    print("PUT admin op ->", code, body[:200])

    code, body = http("GET", "/.groups/spartan/.users/admin")
    print("GET admin after ->", code, body[:300])

    # Sync disk file too
    g["users"]["admin"]["permissions"] = "op"
    (ROOT / "groups/spartan.json").write_text(
        json.dumps(g, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print("disk file updated")


if __name__ == "__main__":
    main()
