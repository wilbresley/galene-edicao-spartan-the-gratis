#!/usr/bin/env python3
import json, subprocess, base64
from pathlib import Path
root = Path(__file__).resolve().parents[1]
g = json.loads((root / "groups/spartan.json").read_text(encoding="utf-8"))
print("file admin perm:", g["users"]["admin"].get("permissions"))
print("file users:", list((g.get("users") or {}).keys()))
print("accounts:", json.loads((root / "data/accounts.json").read_text(encoding="utf-8")))
auth = (root / "data/sidecar.auth").read_text(encoding="utf-8").strip()
b64 = base64.b64encode(auth.encode()).decode()
hdr = f"Authorization: Basic {b64}"

def galene_get(path):
    out = subprocess.run(
        ["docker", "exec", "galene", "wget", "-qO-", f"--header={hdr}", f"http://127.0.0.1:8443{path}"],
        capture_output=True, text=True,
    )
    return out.returncode, (out.stdout or out.stderr).strip()

for p in [
    "/.groups/spartan/.users/",
    "/.groups/spartan/.users/admin",
    "/.groups/spartan/.wildcard-user",
]:
    code, body = galene_get(p)
    print(f"GET {p} -> rc={code} {body[:300]}")
