#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from threading import Thread
import json, secrets, time, urllib.request, urllib.error, base64, os, hashlib, hmac

DATA, GROUPS, GALENE, PORT = Path("/data/registry.json"), Path("/groups"), "http://127.0.0.1:8443", 8091
SITE=Path("/data/site.json")
TZ = ZoneInfo("America/Sao_Paulo")
BAN_IP = False


def load_site():
    d={"main":"spartan","home":"spartan"}
    if SITE.exists():
        try: d.update(json.loads(SITE.read_text(encoding="utf-8")))
        except Exception: pass
    d["main"]=d.get("main") or "spartan"
    d["home"]=d.get("home") or d["main"]
    return d
def save_site(d):
    SITE.write_text(json.dumps(d, indent=2, ensure_ascii=False)+chr(10), encoding="utf-8")
def slug_ok(s):
    s=(s or "").strip().lower()
    return bool(s) and all(c.isalnum() or c=="-" for c in s) and len(s)<=32
def now():
    return datetime.now(TZ).isoformat(timespec="seconds")
def load():
    return json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {}
def save(d):
    DATA.parent.mkdir(parents=True, exist_ok=True)
    t=DATA.with_suffix(".tmp"); t.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8"); t.replace(DATA)
def bucket(d,g):
    d.setdefault(g, {})
    for k in ("guests","pending","denied","blocked","created","temps","ipban","seen"): d[g].setdefault(k, {})
    d[g].setdefault("purge", 0)
    return d[g]
def named(g):
    p=GROUPS/f"{g}.json"
    if not p.exists(): return set()
    return set((json.loads(p.read_text(encoding="utf-8")).get("users") or {}))
def is_op(g,u):
    p=GROUPS/f"{g}.json"
    if not p.exists(): return False
    perm=(json.loads(p.read_text(encoding="utf-8")).get("users") or {}).get(u, {}).get("permissions")
    return perm in ("op","admin") or (isinstance(perm, list) and ("op" in perm or "admin" in perm))
def is_open(gid):
    fp=GROUPS/f"{gid}.json"
    if not fp.exists(): return False
    try: g=json.loads(fp.read_text(encoding="utf-8"))
    except Exception: return False
    pw=(g.get("wildcard-user") or {}).get("password")
    return (not pw) or (isinstance(pw, dict) and pw.get("type")=="wildcard")
def galene(method, path, auth, body=None, ctype="application/json", extra_headers=None):
    data=None if body is None else (body.encode() if isinstance(body, str) else body)
    headers={"Authorization":auth or "","Content-Type":ctype}
    if extra_headers:
        for k,v in extra_headers.items():
            if v is not None: headers[k]=v
    req=urllib.request.Request(GALENE+path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=8) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return 500, str(e)
def internal_auth():
    sp=Path("/data/sidecar.auth")
    if sp.exists():
        line=sp.read_text(encoding="utf-8").strip()
        if ":" in line:
            return "Basic "+base64.b64encode(line.encode()).decode()
    return ""
def sidecar_plain():
    sp=Path("/data/sidecar.auth")
    if not sp.exists(): return None, None
    line=sp.read_text(encoding="utf-8").strip()
    if ":" not in line: return None, None
    u,p=line.split(":",1); return u,p
def parse_basic(auth):
    if not auth or not auth.lower().startswith("basic "): return None, None
    try:
        raw=base64.b64decode(auth.split(" ",1)[1].strip()).decode("utf-8")
        if ":" not in raw: return None, None
        u,p=raw.split(":",1); return u,p
    except Exception: return None, None
def password_match(pwobj, password):
    if password is None: return False
    if isinstance(pwobj, str): return pwobj==password
    if not isinstance(pwobj, dict): return False
    t=pwobj.get("type")
    if t=="plain" or (not t and pwobj.get("key") and not pwobj.get("salt")):
        key=pwobj.get("key")
        return isinstance(key,str) and key==password
    if t=="wildcard": return True
    if t=="pbkdf2":
        try:
            key=bytes.fromhex(pwobj.get("key") or "")
            salt=bytes.fromhex(pwobj.get("salt") or "")
            iters=int(pwobj.get("iterations") or 4096)
            if iters < 1 or not key or not salt: return False
            their=hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters, dklen=len(key))
            return hmac.compare_digest(their, key)
        except Exception: return False
    if t=="bcrypt":
        try:
            import bcrypt
            raw=(pwobj.get("key") or "")
            if isinstance(raw,str): raw=raw.encode("utf-8")
            return bcrypt.checkpw(password.encode("utf-8"), raw)
        except Exception: return False
    return False
def load_group(gid):
    p=GROUPS/f"{gid}.json"
    if not p.exists(): return None
    try: return json.loads(p.read_text(encoding="utf-8"))
    except Exception: return None
def find_group_user(gid, user):
    """Retorna (nome_exato, registro) com match case-insensitive."""
    g=load_group(gid)
    if not g: return None, None
    users=g.get("users") or {}
    if user in users: return user, users[user]
    ul=(user or "").lower()
    for k,v in users.items():
        if str(k).lower()==ul: return k, v
    return None, None
def user_perm_name_from(rec):
    if not rec: return None
    perm=rec.get("permissions")
    if isinstance(perm, str): return perm
    if isinstance(perm, list):
        if "admin" in perm: return "admin"
        if "op" in perm: return "op"
    return None
def user_perm_name(gid, user):
    _,rec=find_group_user(gid, user)
    return user_perm_name_from(rec)
def user_password_ok(gid, user, password):
    _,rec=find_group_user(gid, user)
    if not rec: return False
    return password_match(rec.get("password"), password)
def galene_user_auth_ok(gid, user, password):
    """Valida nick+senha como o Galene (endpoint de senha aceita a própria conta)."""
    auth="Basic "+base64.b64encode(f"{user}:{password}".encode("utf-8")).decode()
    qg,qu=quote(gid,safe=""), quote(user,safe="")
    # Auth correto + body inválido → 415/400. Auth errado → 401.
    code,_=galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", auth, "x", "text/plain")
    if code==401: return False
    return code in (400, 415, 200, 204, 201)
def config_admin_ok(user, password):
    cfg=Path("/data/config.json")
    if not cfg.exists(): return False
    try: d=json.loads(cfg.read_text(encoding="utf-8"))
    except Exception: return False
    users=d.get("users") or {}
    rec=users.get(user)
    if not rec:
        ul=(user or "").lower()
        for k,v in users.items():
            if str(k).lower()==ul:
                rec=v; break
    if not rec: return False
    perm=rec.get("permissions")
    ok_perm=(perm=="admin") or (isinstance(perm, list) and "admin" in perm)
    return ok_perm and password_match(rec.get("password"), password)
def panel_login_ok(user, password):
    user=(user or "").strip()
    if not user or password is None: return False
    su,spw=sidecar_plain()
    if su is not None and user.lower()==su.lower() and password==spw: return True
    if config_admin_ok(user, password): return True
    site=load_site(); main=site.get("main") or "spartan"
    seen=set()
    for gid in [main]+[fp.stem for fp in GROUPS.glob("*.json")]:
        if gid in seen: continue
        seen.add(gid)
        real, rec=find_group_user(gid, user)
        if not real: continue
        perm=user_perm_name_from(rec)
        if perm not in ("op","admin"): continue
        if password_match(rec.get("password"), password): return True
        if galene_user_auth_ok(gid, real, password): return True
    return False
def hash_plain(pw):
    salt=os.urandom(8)
    key=hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, 4096, dklen=32)
    return {"type":"pbkdf2","hash":"sha-256","key":key.hex(),"salt":salt.hex(),"iterations":4096}
def harden_group(gid):
    fp=GROUPS/f"{gid}.json"
    if not fp.exists(): return
    try: g=json.loads(fp.read_text(encoding="utf-8"))
    except Exception: return
    c=0
    def conv(obj):
        nonlocal c
        if not isinstance(obj, dict): return
        pw=obj.get("password")
        if isinstance(pw,str) and pw:
            obj["password"]=hash_plain(pw); c+=1
    for u in (g.get("users") or {}).values(): conv(u)
    conv(g.get("wildcard-user") or {})
    if c: fp.write_text(json.dumps(g, indent=2, ensure_ascii=False)+chr(10), encoding="utf-8")
def ok_nick(u):
    u=(u or "").strip(); return bool(u) and ("/" not in u) and len(u)<=32
def shadow(auth,g,u):
    pw=secrets.token_urlsafe(18); qg,qu=quote(g,safe=""), quote(u,safe="")
    galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}", auth, '{"permissions":"observe"}')
    galene("POST", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", auth, pw, "text/plain")
    harden_group(g)
def ip_banned(b, ip):
    if not BAN_IP: return False
    until=(b.get("ipban") or {}).get(ip)
    if not until: return False
    try: return datetime.fromisoformat(until)>datetime.now(TZ)
    except Exception: return False
def purge_open():
    d=load(); until=(datetime.now(TZ)+timedelta(hours=24)).isoformat(timespec="seconds")
    for fp in GROUPS.glob("*.json"):
        gid=fp.stem
        if not is_open(gid): continue
        b=bucket(d,gid); b["purge"]=int(b.get("purge") or 0)+1
        bans=b.setdefault("ipban",{})
        for rec in (b.get("temps") or {}).values():
            ip=rec.get("ip")
            if ip: bans[ip]=until
            rec.setdefault("clears",[]).append(datetime.now(TZ).isoformat(timespec="seconds"))
    save(d)
def purge_loop():
    while True:
        nnow=datetime.now(TZ)
        nxt=nnow.replace(minute=0,second=0,microsecond=0)+timedelta(hours=1)
        time.sleep(max(1.0,(nxt-nnow).total_seconds()))
        try: purge_open()
        except Exception: pass

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_json(self, code, obj):
        b=json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control","no-store"); self.end_headers(); self.wfile.write(b)
    def send_raw(self, code, body, ctype="text/plain; charset=utf-8"):
        if body is None: body=b""
        if isinstance(body, str): body=body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control","no-store")
        self.end_headers()
        if body: self.wfile.write(body)
    def read_json(self):
        n=int(self.headers.get("Content-Length") or 0)
        try: return json.loads(self.rfile.read(n) if n else b"{}")
        except Exception: return {}
    def route(self):
        u=urlparse(self.path); path=u.path
        if path.startswith("/spartan-api"): path=path[len("/spartan-api"):] or "/"
        if not path.startswith("/"): path="/"+path
        return path, parse_qs(u.query)
    def admin_ok(self):
        auth=self.headers.get("Authorization") or self.headers.get("X-Spartan-Auth") or ""
        user, password=parse_basic(auth)
        if panel_login_ok(user, password):
            return True, internal_auth() or auth
        return False, auth
    def cip(self):
        xff=(self.headers.get("X-Forwarded-For") or self.headers.get("X-Real-IP") or "").split(",")[0].strip()
        return xff or (self.client_address[0] if self.client_address else "")
    def handle_gapi(self, method):
        """Proxy /gapi/* → Galene /galene-api/v0/* com auth do sidecar (ops da sala entram no painel)."""
        path,_=self.route()
        if not path.startswith("/gapi"):
            self.send_json(404, {"error":"not found"}); return
        rest=path[len("/gapi"):] or "/"
        if not rest.startswith("/"): rest="/"+rest
        gpath="/galene-api/v0"+rest
        auth=self.headers.get("Authorization") or self.headers.get("X-Spartan-Auth") or ""
        user, password=parse_basic(auth)
        if not panel_login_ok(user, password):
            self.send_raw(401, '{"error":"Usuário ou senha inválidos"}', "application/json; charset=utf-8")
            return
        galene_auth=internal_auth()
        if not galene_auth:
            self.send_raw(500, '{"error":"sidecar.auth ausente ou inválido no servidor"}', "application/json; charset=utf-8")
            return
        ctype=self.headers.get("Content-Type") or "application/json"
        n=int(self.headers.get("Content-Length") or 0)
        raw=None
        if method not in ("GET","HEAD","DELETE") and n>0:
            raw=self.rfile.read(n)
        elif n>0:
            self.rfile.read(n)
        extra={}
        inm=self.headers.get("If-None-Match")
        if inm: extra["If-None-Match"]=inm
        im=self.headers.get("If-Match")
        if im: extra["If-Match"]=im
        if method in ("GET","HEAD","DELETE"):
            ctype_send="application/json"
        else:
            ctype_send=ctype
        code, text=galene(method, gpath, galene_auth, raw, ctype_send, extra)
        out_ctype="application/json; charset=utf-8"
        if text and text[:1] not in "{[" and not (ctype or "").startswith("application/json"):
            out_ctype="text/plain; charset=utf-8"
        self.send_raw(code, text, out_ctype)
    def do_GET(self):
        path,q=self.route()
        if path.startswith("/gapi"): self.handle_gapi("GET"); return
        if path in ("/","/health"): self.send_json(200, {"ok":True}); return
        if path=="/site":
            self.send_json(200, load_site()); return
        if path=="/rooms":
            rooms=[]
            for fp in sorted(GROUPS.glob("*.json")):
                try: g=json.loads(fp.read_text(encoding="utf-8"))
                except Exception: continue
                pw=(g.get("wildcard-user") or {}).get("password")
                rooms.append({"id":fp.stem,"title":g.get("displayName") or fp.stem,"public":bool(g.get("public")),
                    "open": (not pw) or (isinstance(pw, dict) and pw.get("type")=="wildcard"),
                    "updated": datetime.fromtimestamp(fp.stat().st_mtime, TZ).isoformat(timespec="seconds")})
            self.send_json(200, rooms); return
        if path=="/temp-status":
            g=(q.get("group") or ["spartan"])[0]; user=(q.get("user") or [""])[0].strip()
            d=load(); b=bucket(d,g)
            self.send_json(200, {"open":is_open(g),"purge":int(b.get("purge") or 0),"banned":ip_banned(b,self.cip()),
                "taken": user in named(g) or user in (b.get("pending") or {}) or user in (b.get("denied") or {}) or user in (b.get("blocked") or {})})
            return
        if path=="/status":
            g=(q.get("group") or ["spartan"])[0]; user=(q.get("user") or [""])[0].strip(); b=bucket(load(), g)
            st="denied" if user in b["denied"] else "blocked" if user in b["blocked"] else "pending" if user in b["pending"] else "named" if user in named(g) else ("temp" if is_open(g) else "guest")
            self.send_json(200, {"status":st, "created": (b.get("created") or {}).get(user)}); return
        if path=="/registry":
            ok,_=self.admin_ok(); self.send_json(200 if ok else 401, load() if ok else {"error":"nao autorizado"}); return
        self.send_json(404, {"error":"not found"})
    def do_PUT(self):
        path,_=self.route()
        if path.startswith("/gapi"): self.handle_gapi("PUT"); return
        self.send_json(404, {"error":"not found"})
    def do_DELETE(self):
        path,_=self.route()
        if path.startswith("/gapi"): self.handle_gapi("DELETE"); return
        self.send_json(404, {"error":"not found"})
    def do_POST(self):
        path,_=self.route()
        if path.startswith("/gapi"): self.handle_gapi("POST"); return
        body=self.read_json()
        g=(body.get("group") or "spartan").strip() or "spartan"; user=(body.get("user") or "").strip()
        if path=="/beacon":
            if not ok_nick(user): self.send_json(400, {"error":"nick invalido"}); return
            d=load(); b=bucket(d,g); t=now(); ip=self.cip()
            if ip_banned(b, ip): self.send_json(403, {"error":"IP suspenso nesta sala por 24h"}); return
            rec=b.setdefault("seen",{}).setdefault(user, {"first":t,"last":t,"ip":ip}); rec["last"]=t; rec["ip"]=ip
            if user in named(g):
                save(d); self.send_json(200, {"ok":True,"named":True}); return
            if is_open(g):
                rec=b.setdefault("temps",{}).setdefault(user, {"first":t,"last":t,"ip":ip}); rec["last"]=t; rec["ip"]=ip
            else:
                rec=b["guests"].setdefault(user, {"first":t,"last":t,"ip":ip}); rec["last"]=t; rec["ip"]=ip
            save(d); self.send_json(200, {"ok":True}); return
        if path=="/register":
            pw=body.get("password") or ""
            if not ok_nick(user) or len(pw)<8: self.send_json(400, {"error":"nick ou senha (minimo 8)"}); return
            if is_open(g): self.send_json(403, {"error":"sala publica nao tem cadastro"}); return
            d=load(); b=bucket(d,g)
            if user in b["denied"] or user in b["blocked"]: self.send_json(403, {"error":"este nick foi bloqueado"}); return
            if user in named(g): self.send_json(409, {"error":"este nick ja tem cadastro"}); return
            t=now(); b["pending"][user]={"at":t}
            b["guests"].setdefault(user, {"first":t,"last":t})["last"]=t; save(d)
            ia=internal_auth()
            if ia:
                qg,qu=quote(g,safe=""), quote(user,safe="")
                galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}", ia, '{"permissions":"observe"}')
                galene("POST", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", ia, pw, "text/plain"); harden_group(g)
            self.send_json(200, {"ok":True}); return
        if path=="/panel-login":
            u=(body.get("user") or user or "").strip()
            pw=body.get("password") if "password" in body else body.get("pass")
            if pw is None: pw=""
            if panel_login_ok(u, pw):
                self.send_json(200, {"ok":True})
            else:
                self.send_json(401, {"error":"Usuário ou senha inválidos. Use a conta op/admin da sala (a mesma da entrada), não a senha de amigos."})
            return
        ok,auth=self.admin_ok()
        if not ok: self.send_json(401, {"error":"nao autorizado"}); return
        if path=="/site-home":
            gid=(body.get("group") or "").strip()
            if not (GROUPS/f"{gid}.json").exists(): self.send_json(404, {"error":"sala nao existe"}); return
            st=load_site(); st["home"]=gid; save_site(st); self.send_json(200, st); return
        if path=="/rename-main":
            st=load_site(); old=st["main"]; title=(body.get("title") or "").strip()
            nid=(body.get("id") or old).strip().lower()
            if not slug_ok(nid): self.send_json(400, {"error":"nome de URL invalido"}); return
            op,np=GROUPS/f"{old}.json", GROUPS/f"{nid}.json"
            if not op.exists(): self.send_json(404, {"error":"sala principal sumiu"}); return
            g=json.loads(op.read_text(encoding="utf-8"))
            if title: g["displayName"]=title
            if nid!=old:
                if np.exists(): self.send_json(409, {"error":"ja existe uma sala com esse nome"}); return
                np.write_text(json.dumps(g, indent=2, ensure_ascii=False)+chr(10), encoding="utf-8")
                op.unlink()
                d=load()
                if old in d: d[nid]=d.pop(old); save(d)
                if st.get("home")==old: st["home"]=nid
                st["main"]=nid
            else:
                op.write_text(json.dumps(g, indent=2, ensure_ascii=False)+chr(10), encoding="utf-8")
            save_site(st); self.send_json(200, st); return
        if not ok_nick(user): self.send_json(400, {"error":"nick invalido"}); return
        if is_op(g,user) and path in ("/deny","/block","/forget"):
            self.send_json(403, {"error":"nao bloqueia admin"}); return
        d=load(); b=bucket(d,g); qg,qu=quote(g,safe=""), quote(user,safe="")
        if path=="/approve":
            pend=b["pending"].get(user)
            if not pend: self.send_json(404, {"error":"sem pedido pendente"}); return
            galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}", auth, '{"permissions":"present"}')
            if pend.get("password"):
                code,err=galene("POST", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", auth, pend["password"], "text/plain")
                if code>=400: self.send_json(code, {"error":err[:200]}); return
            harden_group(g)
            b["pending"].pop(user,None); b["denied"].pop(user,None); b["blocked"].pop(user,None); b["guests"].pop(user,None)
            b.setdefault("created",{})[user]=now(); save(d); self.send_json(200, {"ok":True}); return
        if path=="/quick":
            pw=body.get("password") or ""; perm=body.get("permissions") or "present"
            if len(pw)<8: self.send_json(400, {"error":"senha minimo 8"}); return
            galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}", auth, json.dumps({"permissions":perm}))
            galene("POST", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", auth, pw, "text/plain")
            harden_group(g)
            b["pending"].pop(user,None); b["denied"].pop(user,None); b["blocked"].pop(user,None); b["guests"].pop(user,None)
            b.setdefault("created",{})[user]=now(); save(d); self.send_json(200, {"ok":True}); return
        if path in ("/deny","/block"):
            tt=now(); kind="named" if user in named(g) else "guest"
            if kind=="guest" or path=="/deny": shadow(auth,g,user)
            (b["denied"] if path=="/deny" else b["blocked"])[user]={"at":tt,"kind":kind}
            b["pending"].pop(user,None); save(d); self.send_json(200, {"ok":True}); return
        if path=="/unblock":
            info=(b.get("blocked") or {}).pop(user, {}) or {}
            if info.get("kind")=="guest": galene("DELETE", f"/galene-api/v0/.groups/{qg}/.users/{qu}", auth)
            else: galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}", auth, '{"permissions":"present"}')
            save(d); self.send_json(200, {"ok":True}); return
        if path=="/stamp":
            b.setdefault("created",{})[user]=now(); save(d); self.send_json(200, {"ok":True}); return
        if path=="/forget":
            galene("DELETE", f"/galene-api/v0/.groups/{qg}/.users/{qu}", auth)
            for k in ("pending","denied","blocked","guests","temps"): b[k].pop(user, None)
            save(d); self.send_json(200, {"ok":True}); return
        self.send_json(404, {"error":"not found"})

if __name__=="__main__":
    Thread(target=purge_loop, daemon=True).start()
    print("spartan-reg on", PORT, flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
