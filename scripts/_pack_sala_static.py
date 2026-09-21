#!/usr/bin/env python3
"""Monta S:\\Downloads\\galene-sala-static (zera e copia)."""
from pathlib import Path
import shutil

ROOT = Path(r"s:\Workspaces\galene-edicao-spartan")
DST = Path(r"S:\Downloads\galene-sala-static")

if DST.exists():
    for child in DST.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
else:
    DST.mkdir(parents=True)

shutil.copy2(ROOT / "registry.py", DST / "registry.py")
static_dst = DST / "static"
static_dst.mkdir()
for name in (
    "admin.js",
    "admin.html",
    "admin.css",
):
    src = ROOT / "static" / name
    if src.exists():
        shutil.copy2(src, static_dst / name)
admin_dir = static_dst / "admin"
admin_dir.mkdir()
shutil.copy2(ROOT / "static" / "admin" / "index.html", admin_dir / "index.html")

leia = """Pacote: contas unificadas + desativacao (ID permanente)

No Debian (pasta solta em ~/docker/galene-spartan/galene-sala-static):

cd ~/docker/galene-spartan && cp -f galene-sala-static/registry.py ./registry.py && cp -a galene-sala-static/static/. ./static/ && docker restart spartan-reg

Depois: Ctrl+F5 no navegador. Confira admin.js?v=59.
"""
(DST / "LEIA-ME.txt").write_text(leia, encoding="utf-8")
print("ok", DST)
for p in sorted(DST.rglob("*")):
    if p.is_file():
        print(" ", p.relative_to(DST))
