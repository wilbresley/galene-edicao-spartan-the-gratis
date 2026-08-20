#!/usr/bin/env python3
"""Sidecar da interface Spartan — API em :8091 (prefixo /spartan-api)."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from threading import Thread, Lock
import json, time, urllib.request, urllib.error, base64, hmac

DATA = Path("/data/registry.json")
SITE = Path("/data/site.json")
AUTH = Path("/data/sidecar.auth")
GROUPS = Path("/groups")
GALENE = "http://127.0.0.1:8443/galene-api/v0"
PORT = 8091
TZ = ZoneInfo("America/Sao_Paulo")
BAN_IP = False
LOCK = Lock()


def now():
    return datetime.now(TZ).isoformat(timespec="seconds")


def load():
    if not DATA.exists():
        return {}
    try:
        return json.loads(DATA.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save(d):
    DATA.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(DATA)


def bucket(d, g):
    d.setdefault(g, {})
    b = d[g]
    for k in ("guests", "pending", "denied", "blocked", "created", "temps", "ipban", "seen"):
        b.setdefault(k, {})
    b.setdefault("purge", 0)
    return b


def load_site():
    d = {"main": "spartan", "home": "spartan"}
    if SITE.exists():
        try:
            d.update(json.loads(SITE.read_text(encoding="utf-8")))
        except Exception:
            pass
    d["main"] = d.get("main") or "spartan"
    d["home"] = d.get("home") or d["main"]
    return d


def save_site(d):
    SITE.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def slug_ok(s):
    s = (s or "").strip().lower()
    return bool(s) and all(c.isalnum() or c == "-" for c in s) and 1 <= len(s) <= 32


def ok_nick(s):
    s = (s or "").strip()
    if not s or len(s) > 32:
        return False
    return all(c.isalnum() or c in "-_." for c in s)


def named(g):
    p = GROUPS / f"{g}.json"
    if not p.exists():
        return set()
    try:
        return set((json.loads(p.read_text(encoding="utf-8")).get("users") or {}))
    except Exception:
        return set()


def group_json(g):
    p = GROUPS / f"{g}.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def is_open(gid):
    wu = group_json(gid).get("wildcard-user") or {}
    pw = wu.get("password")
    return isinstance(pw, dict) and pw.get("type") == "wildcard"


def sidecar_creds():
    if not AUTH.exists():
        return None
    raw = AUTH.read_text(encoding="utf-8").strip()
    if ":" not in raw:
        return None
    u, p = raw.split(":", 1)
    return u, p


def galene(method, path, body=None, auth=None, content_type="application/json"):
    creds = auth or sidecar_creds()
    if not creds:
        raise RuntimeError("sidecar.auth ausente")
    data = None
    headers = {}
    token = base64.b64encode(f"{creds[0]}:{creds[1]}".encode()).decode()
    headers["Authorization"] = "Basic " + token
    if body is not None:
        if isinstance(body, (dict, list)):
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        else:
            data = body if isinstance(body, bytes) else str(body).encode("utf-8")
            headers["Content-Type"] = content_type
    req = urllib.request.Request(GALENE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            raw = r.read()
            if not raw:
                return None
            try:
                return json.loads(raw.decode("utf-8"))
            except Exception:
                return raw.decode("utf-8")
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", "replace")[:220]
        raise RuntimeError(msg or str(e.code)) from e


def ip_banned(b, ip):
    if not BAN_IP or not ip:
        return False
    until = (b.get("ipban") or {}).get(ip)
    if not until:
        return False
    try:
        return datetime.fromisoformat(until) > datetime.now(TZ)
    except Exception:
        return False


def client_ip(handler):
    fwd = handler.headers.get("X-Forwarded-For") or ""
    if fwd:
        return fwd.split(",")[0].strip()
    real = handler.headers.get("X-Real-IP")
    if real:
        return real.strip()
    return handler.client_address[0]


def rooms_public():
    out = []
    for p in sorted(GROUPS.glob("*.json")):
        gid = p.stem
        try:
            g = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not g.get("public"):
            continue
        out.append({
            "id": gid,
            "title": g.get("displayName") or gid,
            "open": is_open(gid),
            "updated": datetime.fromtimestamp(p.stat().st_mtime, TZ).isoformat(timespec="seconds"),
        })
    return out


def status_of(gid, user):
    d = load()
    b = bucket(d, gid)
    if user in (b.get("blocked") or {}):
        return "blocked"
    if user in (b.get("denied") or {}):
        return "denied"
    if user in (b.get("pending") or {}):
        return "pending"
    if user in named(gid):
        return "named"
    if is_open(gid) and user in (b.get("temps") or {}):
        return "temp"
    if user in (b.get("guests") or {}):
        return "guest"
    return "unknown"


def put_user(gid, user, password, permissions="present"):
    galene("PUT", f"/.groups/{quote(gid)}/.users/{quote(user)}", {"permissions": permissions})
    galene("POST", f"/.groups/{quote(gid)}/.users/{quote(user)}/.password", password, content_type="text/plain")


def delete_user(gid, user):
    try:
        galene("DELETE", f"/.groups/{quote(gid)}/.users/{quote(user)}")
    except Exception:
        pass


def parse_basic(header):
    if not header or not header.lower().startswith("basic "):
        return None
    try:
        raw = base64.b64decode(header.split(" ", 1)[1]).decode("utf-8")
        u, p = raw.split(":", 1)
        return u, p
    except Exception:
        return None


def purge_open_rooms():
    d = load()
    changed = False
    for p in GROUPS.glob("*.json"):
        gid = p.stem
        if not is_open(gid):
            continue
        b = bucket(d, gid)
        b["purge"] = int(b.get("purge") or 0) + 1
        b["temps"] = {}
        if BAN_IP:
            until = (datetime.now(TZ) + timedelta(hours=24)).isoformat(timespec="seconds")
            for rec in (b.get("seen") or {}).values():
                ip = (rec or {}).get("ip")
                if ip:
                    b.setdefault("ipban", {})[ip] = until
        changed = True
    if changed:
        save(d)


def purge_loop():
    while True:
        now_dt = datetime.now(TZ)
        nxt = now_dt.replace(minute=0, second=5, microsecond=0) + timedelta(hours=1)
        time.sleep(max(1, (nxt - now_dt).total_seconds()))
        try:
            purge_open_rooms()
        except Exception:
            pass


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def send_json(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def route(self):
        u = urlparse(self.path)
        path = u.path.rstrip("/") or "/"
        if path.startswith("/spartan-api"):
            path = path[len("/spartan-api"):] or "/"
        return path, parse_qs(u.query)

    def admin_ok(self):
        got = parse_basic(self.headers.get("Authorization"))
        want = sidecar_creds()
        if not got or not want:
            return False, None
        if hmac.compare_digest(got[0], want[0]) and hmac.compare_digest(got[1], want[1]):
            return True, got
        return False, got

    def do_GET(self):
        path, qs = self.route()
        gid = (qs.get("group") or [""])[0]
        user = (qs.get("user") or [""])[0]
        if path in ("/", "/health"):
            self.send_json(200, {"ok": True})
            return
        if path == "/site":
            self.send_json(200, load_site())
            return
        if path == "/rooms":
            self.send_json(200, rooms_public())
            return
        if path == "/status":
            b = bucket(load(), gid)
            self.send_json(200, {
                "status": status_of(gid, user),
                "created": (b.get("created") or {}).get(user),
                "banned": ip_banned(b, client_ip(self)),
                "open": is_open(gid),
                "purge": int(b.get("purge") or 0),
            })
            return
        if path == "/temp-status":
            b = bucket(load(), gid)
            taken = user in named(gid) or user in (b.get("guests") or {}) or user in (b.get("pending") or {})
            self.send_json(200, {
                "open": is_open(gid),
                "purge": int(b.get("purge") or 0),
                "banned": ip_banned(b, client_ip(self)),
                "taken": taken,
            })
            return
        if path == "/registry":
            ok, _ = self.admin_ok()
            if not ok:
                self.send_json(401, {"error": "nao autorizado"})
                return
            self.send_json(200, load())
            return
        self.send_json(404, {"error": "nao encontrado"})

    def do_POST(self):
        path, _qs = self.route()
        body = self.read_json()
        gid = (body.get("group") or "").strip()
        user = (body.get("user") or "").strip()
        ip = client_ip(self)

        if path == "/beacon":
            if not gid or not user:
                self.send_json(400, {"error": "dados invalidos"})
                return
            with LOCK:
                d = load()
                b = bucket(d, gid)
                rec = {"first": now(), "last": now(), "ip": ip}
                prev = (b.get("seen") or {}).get(user) or {}
                if prev.get("first"):
                    rec["first"] = prev["first"]
                b["seen"][user] = rec
                if is_open(gid):
                    t = dict(rec)
                    prevt = (b.get("temps") or {}).get(user) or {}
                    if prevt.get("first"):
                        t["first"] = prevt["first"]
                    b["temps"][user] = t
                elif user not in named(gid):
                    g = dict(rec)
                    prevg = (b.get("guests") or {}).get(user) or {}
                    if prevg.get("first"):
                        g["first"] = prevg["first"]
                    b["guests"][user] = g
                save(d)
            self.send_json(200, {"ok": True})
            return

        if path == "/register":
            pw = body.get("password") or ""
            if not gid or not ok_nick(user) or len(pw) < 8:
                self.send_json(400, {"error": "nick ou senha invalidos"})
                return
            if is_open(gid):
                self.send_json(400, {"error": "sala publica nao usa cadastro"})
                return
            with LOCK:
                d = load()
                b = bucket(d, gid)
                if user in (b.get("blocked") or {}) or user in (b.get("denied") or {}):
                    self.send_json(403, {"error": "nick bloqueado"})
                    return
                if user in named(gid):
                    self.send_json(409, {"error": "nick ja cadastrado"})
                    return
                try:
                    put_user(gid, user, pw, "present")
                except Exception as e:
                    self.send_json(502, {"error": str(e)})
                    return
                b["pending"][user] = {"at": now()}
                b.get("guests", {}).pop(user, None)
                save(d)
            self.send_json(200, {"ok": True})
            return

        ok, auth = self.admin_ok()
        if not ok:
            self.send_json(401, {"error": "nao autorizado"})
            return

        if path == "/site-home":
            if not (GROUPS / f"{gid}.json").exists():
                self.send_json(404, {"error": "sala nao existe"})
                return
            st = load_site()
            st["home"] = gid
            save_site(st)
            self.send_json(200, st)
            return

        if path == "/rename-main":
            st = load_site()
            old = st["main"]
            title = (body.get("title") or "").strip()
            nid = (body.get("id") or old).strip().lower()
            if not slug_ok(nid):
                self.send_json(400, {"error": "nome de URL invalido"})
                return
            op, np = GROUPS / f"{old}.json", GROUPS / f"{nid}.json"
            if not op.exists():
                self.send_json(404, {"error": "sala principal sumiu"})
                return
            g = json.loads(op.read_text(encoding="utf-8"))
            if title:
                g["displayName"] = title
            if nid != old:
                if np.exists():
                    self.send_json(409, {"error": "ja existe uma sala com esse nome"})
                    return
                np.write_text(json.dumps(g, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                op.unlink()
                d = load()
                if old in d:
                    d[nid] = d.pop(old)
                    save(d)
                if st.get("home") == old:
                    st["home"] = nid
                st["main"] = nid
            else:
                op.write_text(json.dumps(g, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            save_site(st)
            self.send_json(200, st)
            return

        if not ok_nick(user):
            self.send_json(400, {"error": "nick invalido"})
            return

        with LOCK:
            d = load()
            b = bucket(d, gid)

            if path == "/approve":
                b.get("pending", {}).pop(user, None)
                b.get("denied", {}).pop(user, None)
                b.get("guests", {}).pop(user, None)
                b.setdefault("created", {})[user] = now()
                save(d)
                self.send_json(200, {"ok": True})
                return

            if path == "/quick":
                pw = body.get("password") or ""
                perm = body.get("permissions") or "present"
                if len(pw) < 8:
                    self.send_json(400, {"error": "senha curta"})
                    return
                try:
                    put_user(gid, user, pw, perm)
                except Exception as e:
                    self.send_json(502, {"error": str(e)})
                    return
                for k in ("pending", "denied", "blocked", "guests", "temps"):
                    b.get(k, {}).pop(user, None)
                b.setdefault("created", {})[user] = now()
                save(d)
                self.send_json(200, {"ok": True})
                return

            if path == "/deny":
                delete_user(gid, user)
                b.get("pending", {}).pop(user, None)
                b.get("guests", {}).pop(user, None)
                b.setdefault("denied", {})[user] = {"at": now()}
                save(d)
                self.send_json(200, {"ok": True})
                return

            if path == "/block":
                b.setdefault("blocked", {})[user] = {"at": now(), "ip": ip}
                b.get("pending", {}).pop(user, None)
                save(d)
                self.send_json(200, {"ok": True})
                return

            if path == "/unblock":
                b.get("blocked", {}).pop(user, None)
                save(d)
                self.send_json(200, {"ok": True})
                return

            if path == "/forget":
                delete_user(gid, user)
                for k in ("guests", "pending", "denied", "blocked", "created", "temps", "seen"):
                    b.get(k, {}).pop(user, None)
                save(d)
                self.send_json(200, {"ok": True})
                return

            if path == "/stamp":
                b.setdefault("created", {})[user] = now()
                save(d)
                self.send_json(200, {"ok": True})
                return

        self.send_json(404, {"error": "nao encontrado"})


if __name__ == "__main__":
    Thread(target=purge_loop, daemon=True).start()
    print(f"spartan-reg on {PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
