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
ACCOUNTS=Path("/data/accounts.json")
ACCESS_LOG=Path("/data/access.log")
TZ = ZoneInfo("America/Sao_Paulo")
BAN_IP = False
_ACCESS_WRITE = 0
_LAST_ACCESS = {}
# Prefixos comuns da Cloudflare — evita gravar hop do CDN como "IP do usuário"
_CF_PREFIXES = (
    "104.16.","104.17.","104.18.","104.19.","104.20.","104.21.","104.22.","104.23.",
    "104.24.","104.25.","104.26.","104.27.","104.28.","172.64.","172.65.","172.66.",
    "172.67.","172.68.","172.69.","172.70.","172.71.","198.41.","162.158.","141.101.",
)


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
def now():
    return datetime.now(TZ).isoformat(timespec="seconds")
def _looks_cf(ip):
    ip=(ip or "").strip()
    return any(ip.startswith(p) for p in _CF_PREFIXES)
def access_log(kind, group, user, ip, **extra):
    """Append JSONL em /data/access.log (retenção ~1 ano). Dedupa 5 min por nick+ip+sala+tipo."""
    global _ACCESS_WRITE
    user=norm_nick(user); group=(group or "").strip() or "spartan"; ip=(ip or "").strip()
    if not user: return
    key=(group, user, ip, kind)
    tnow=datetime.now(TZ)
    prev=_LAST_ACCESS.get(key)
    if prev and (tnow-prev).total_seconds() < 300:
        return
    _LAST_ACCESS[key]=tnow
    rec={"quando":now(),"tipo":kind,"sala":group,"nick":user,"ip":ip}
    for k,v in extra.items():
        if v is not None: rec[k]=v
    try:
        ACCESS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with ACCESS_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False)+"\n")
        _ACCESS_WRITE += 1
        if _ACCESS_WRITE % 40 == 0:
            prune_access_log()
    except Exception:
        pass
def prune_access_log():
    if not ACCESS_LOG.exists(): return
    try:
        cutoff=datetime.now(TZ)-timedelta(days=365)
        keep=[]
        with ACCESS_LOG.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line=line.strip()
                if not line: continue
                try:
                    o=json.loads(line)
                    ts=datetime.fromisoformat(o.get("quando") or "")
                    if ts.tzinfo is None: ts=ts.replace(tzinfo=TZ)
                    if ts >= cutoff: keep.append(line)
                except Exception:
                    keep.append(line)
        tmp=ACCESS_LOG.with_suffix(".tmp")
        tmp.write_text(("\n".join(keep)+("\n" if keep else "")), encoding="utf-8")
        tmp.replace(ACCESS_LOG)
    except Exception:
        pass
def read_access_log(limit=300):
    if not ACCESS_LOG.exists(): return []
    try:
        lines=ACCESS_LOG.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return []
    out=[]
    for line in reversed(lines):
        line=line.strip()
        if not line: continue
        try: out.append(json.loads(line))
        except Exception: continue
        if len(out) >= limit: break
    return out
def load_accounts():
    d={"next_id":1,"by_id":{},"by_nick":{}}
    if ACCOUNTS.exists():
        try:
            raw=json.loads(ACCOUNTS.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                d["next_id"]=int(raw.get("next_id") or 1)
                d["by_id"]=dict(raw.get("by_id") or {})
                d["by_nick"]=dict(raw.get("by_nick") or {})
        except Exception: pass
    if "0" not in d["by_id"]:
        d["by_id"]["0"]={"nick":"admin","active":True,"created":now()}
        d["by_nick"].setdefault("admin", 0)
    return d
def save_accounts(d):
    ACCOUNTS.parent.mkdir(parents=True, exist_ok=True)
    t=ACCOUNTS.with_suffix(".tmp")
    t.write_text(json.dumps(d, indent=2, ensure_ascii=False)+chr(10), encoding="utf-8")
    t.replace(ACCOUNTS)
def norm_nick(u):
    return (u or "").strip().lower()
def ok_nick(u):
    u=norm_nick(u); return bool(u) and ("/" not in u) and len(u)<=32
def account_ensure(nick, force_id=None):
    """Garante conta com ID imutável. force_id=0 para admin."""
    nick=norm_nick(nick)
    if not nick: return None
    d=load_accounts()
    if nick in d["by_nick"]:
        uid=int(d["by_nick"][nick])
        rec=d["by_id"].setdefault(str(uid), {"nick":nick,"active":True})
        rec["nick"]=nick; rec["active"]=True
        save_accounts(d); return uid
    if force_id is not None:
        uid=int(force_id)
    else:
        uid=int(d.get("next_id") or 1)
        while str(uid) in d["by_id"] or uid==0:
            uid+=1
        d["next_id"]=uid+1
    d["by_id"][str(uid)]={"nick":nick,"active":True,"created":now()}
    d["by_nick"][nick]=uid
    save_accounts(d); return uid
def account_forget_nick(nick):
    nick=norm_nick(nick)
    d=load_accounts()
    uid=d["by_nick"].pop(nick, None)
    if uid is None:
        save_accounts(d); return
    rec=d["by_id"].get(str(uid))
    if rec:
        rec["active"]=False
        rec["freed_at"]=now()
        rec["last_nick"]=nick
        rec["nick"]=None
    save_accounts(d)
def account_rename(uid, new_nick):
    new_nick=norm_nick(new_nick)
    if not ok_nick(new_nick): return False, "nick invalido"
    d=load_accounts()
    rec=d["by_id"].get(str(uid))
    if not rec: return False, "id inexistente"
    old=norm_nick(rec.get("nick") or rec.get("last_nick") or "")
    if new_nick in d["by_nick"] and int(d["by_nick"][new_nick])!=int(uid):
        return False, "nick ja em uso"
    if old and old in d["by_nick"] and int(d["by_nick"][old])==int(uid):
        del d["by_nick"][old]
    rec["nick"]=new_nick; rec["active"]=True
    d["by_nick"][new_nick]=int(uid)
    save_accounts(d); return True, old
def slug_ok(s):
    s=(s or "").strip().lower()
    return bool(s) and all(c.isalnum() or c=="-" for c in s) and len(s)<=32
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
    return set(norm_nick(k) for k in (json.loads(p.read_text(encoding="utf-8")).get("users") or {}))
def load_group(gid):
    p=GROUPS/f"{gid}.json"
    if not p.exists(): return None
    try: return json.loads(p.read_text(encoding="utf-8"))
    except Exception: return None
def save_group(gid, g):
    p=GROUPS/f"{gid}.json"
    p.write_text(json.dumps(g, indent=2, ensure_ascii=False)+chr(10), encoding="utf-8")
def find_group_user(gid, user):
    g=load_group(gid)
    if not g: return None, None
    users=g.get("users") or {}
    ul=norm_nick(user)
    if ul in users: return ul, users[ul]
    if user in users: return user, users[user]
    for k,v in users.items():
        if norm_nick(k)==ul: return k, v
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
def is_op(g,u):
    real,_=find_group_user(g, norm_nick(u))
    if not real: return False
    return user_perm_name(g, real) in ("op","admin")
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
def ensure_open_ouvinte(gid):
    """Sala pública: wildcard = Ouvinte (["present"] sem message). Convite fica Verificado ("present")."""
    if not is_open(gid): return
    ia=internal_auth()
    if not ia: return
    try:
        fp=GROUPS/f"{gid}.json"
        g=json.loads(fp.read_text(encoding="utf-8"))
        wu=g.get("wildcard-user") or {}
        perm=wu.get("permissions")
        if isinstance(perm, list) and "present" in perm and "message" not in perm and "op" not in perm:
            return
        qg=quote(gid, safe="")
        galene("PUT", f"/galene-api/v0/.groups/{qg}/.wildcard-user", ia, json.dumps({"permissions":["present"]}))
    except Exception:
        pass
def sidecar_plain():
    sp=Path("/data/sidecar.auth")
    if not sp.exists(): return None, None
    line=sp.read_text(encoding="utf-8").strip()
    if ":" not in line: return None, None
    u,p=line.split(":",1); return norm_nick(u),p
def parse_basic(auth):
    if not auth or not auth.lower().startswith("basic "): return None, None
    try:
        raw=base64.b64decode(auth.split(" ",1)[1].strip()).decode("utf-8")
        if ":" not in raw: return None, None
        u,p=raw.split(":",1); return norm_nick(u),p
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
def galene_user_auth_ok(gid, user, password):
    auth="Basic "+base64.b64encode(f"{user}:{password}".encode("utf-8")).decode()
    qg,qu=quote(gid,safe=""), quote(user,safe="")
    code,_=galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", auth, "x", "text/plain")
    if code==401: return False
    return code in (400, 415, 200, 204, 201)
def config_admin_ok(user, password):
    cfg=Path("/data/config.json")
    if not cfg.exists(): return False
    try: d=json.loads(cfg.read_text(encoding="utf-8"))
    except Exception: return False
    users=d.get("users") or {}
    ul=norm_nick(user)
    rec=users.get(ul) or users.get(user)
    if not rec:
        for k,v in users.items():
            if norm_nick(k)==ul:
                rec=v; break
    if not rec: return False
    perm=rec.get("permissions")
    ok_perm=(perm=="admin") or (isinstance(perm, list) and "admin" in perm)
    return ok_perm and password_match(rec.get("password"), password)
def main_id():
    return load_site().get("main") or "spartan"
def parse_iso(s):
    if not s: return None
    try:
        dt=datetime.fromisoformat(s)
        if dt.tzinfo is None: dt=dt.replace(tzinfo=TZ)
        return dt
    except Exception:
        return None
def ttl_info(gid, b=None):
    if b is None:
        try: b=bucket(load(), gid)
        except Exception: b={}
    ttl=(b or {}).get("ttl") or {}
    exp=parse_iso(ttl.get("expires_at"))
    if not exp: return {"ttl": False, "expires_at": None, "remaining_s": None, "host": None, "kind": None}
    rem=int((exp-datetime.now(TZ)).total_seconds())
    return {
        "ttl": True,
        "expires_at": ttl.get("expires_at"),
        "remaining_s": max(0, rem),
        "host": ttl.get("host") or None,
        "kind": ttl.get("kind") or ("public" if is_open(gid) else "invite"),
    }
def set_ttl(gid, kind, host=None, hours=24):
    d=load(); b=bucket(d,gid)
    nowdt=datetime.now(TZ)
    b["ttl"]={
        "created_at": nowdt.isoformat(timespec="seconds"),
        "expires_at": (nowdt+timedelta(hours=hours)).isoformat(timespec="seconds"),
        "kind": kind,
        "host": norm_nick(host) if host else None,
    }
    save(d)
    return b["ttl"]
def delete_group_ttl(gid):
    if gid==main_id(): return False
    ia=internal_auth()
    qg=quote(gid, safe="")
    if ia:
        galene("DELETE", f"/galene-api/v0/.groups/{qg}", ia)
    fp=GROUPS/f"{gid}.json"
    try:
        if fp.exists(): fp.unlink()
    except Exception:
        pass
    d=load(); d.pop(gid, None); save(d)
    st=load_site()
    if st.get("home")==gid:
        st["home"]=st.get("main") or "spartan"
        save_site(st)
    return True
def ensure_public_ttl():
    """Salas públicas extra (não a main) passam a ter 24h se ainda não tiverem prazo."""
    d=load(); main=main_id(); nowdt=datetime.now(TZ); changed=False
    for fp in GROUPS.glob("*.json"):
        gid=fp.stem
        if gid==main or not is_open(gid): continue
        b=bucket(d,gid)
        if parse_iso((b.get("ttl") or {}).get("expires_at")): continue
        b["ttl"]={
            "created_at": nowdt.isoformat(timespec="seconds"),
            "expires_at": (nowdt+timedelta(hours=24)).isoformat(timespec="seconds"),
            "kind": "public",
            "host": (b.get("ttl") or {}).get("host"),
        }
        changed=True
    if changed: save(d)
def expire_due():
    d=load(); main=main_id(); nowdt=datetime.now(TZ)
    for gid in list(d.keys()):
        if gid==main: continue
        gone=not (GROUPS/f"{gid}.json").exists()
        ttl=(d.get(gid) or {}).get("ttl") or {}
        exp=parse_iso(ttl.get("expires_at"))
        if gone:
            d.pop(gid, None); save(d); continue
        if exp and exp<=nowdt:
            try: delete_group_ttl(gid)
            except Exception: pass
def expire_loop():
    while True:
        time.sleep(20)
        try: expire_due()
        except Exception: pass
def panel_login_ok(user, password):
    """Só admin de verdade: sidecar.auth, config.json, ou op da sala principal. Anfitrião 24h não entra."""
    user=norm_nick(user)
    if not user or password is None: return False
    su,spw=sidecar_plain()
    if su is not None and user==su and password==spw: return True
    if config_admin_ok(user, password): return True
    main=main_id()
    real, rec=find_group_user(main, user)
    if not real: return False
    perm=user_perm_name_from(rec)
    if perm not in ("op","admin"): return False
    if password_match(rec.get("password"), password): return True
    if galene_user_auth_ok(main, real, password): return True
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
def rename_galene_user(gid, old, new, auth):
    old_real, rec=find_group_user(gid, old)
    if not old_real or not rec: return False, "usuario nao encontrado"
    new=norm_nick(new)
    if not ok_nick(new): return False, "nick invalido"
    if norm_nick(old_real)==new: return True, old_real
    g=load_group(gid)
    if not g: return False, "sala nao existe"
    users=g.setdefault("users", {})
    if any(norm_nick(k)==new for k in users):
        return False, "nick ja existe na sala"
    users[new]=json.loads(json.dumps(rec))
    users.pop(old_real, None)
    for k in list(users.keys()):
        if k!=new and norm_nick(k)==norm_nick(old_real):
            users.pop(k, None)
    save_group(gid, g)
    qg=quote(gid,safe="")
    galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{quote(new,safe='')}", auth,
           json.dumps({"permissions": rec.get("permissions") or "present"}))
    galene("DELETE", f"/galene-api/v0/.groups/{qg}/.users/{quote(old_real,safe='')}", auth)
    harden_group(gid)
    return True, old_real
def shadow(auth,g,u):
    u=norm_nick(u); pw=secrets.token_urlsafe(18); qg,qu=quote(g,safe=""), quote(u,safe="")
    galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}", auth, '{"permissions":"observe"}')
    galene("POST", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", auth, pw, "text/plain")
    harden_group(g)
def ip_banned(b, ip):
    if not BAN_IP: return False
    until=(b.get("ipban") or {}).get(ip)
    if not until: return False
    try: return datetime.fromisoformat(until)>datetime.now(TZ)
    except Exception: return False

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
        """IP do visitante (não o do Cloudflare/proxy)."""
        for h in ("CF-Connecting-IP", "True-Client-IP", "X-Client-IP"):
            v=(self.headers.get(h) or "").strip()
            if v and not v.lower().startswith("unknown"):
                cand=v.split(",")[0].strip()
                if cand and not _looks_cf(cand):
                    return cand
                if cand:
                    return cand
        xff=(self.headers.get("X-Forwarded-For") or "").strip()
        if xff:
            parts=[p.strip() for p in xff.split(",") if p.strip()]
            for p in parts:
                if not _looks_cf(p): return p
            for p in reversed(parts):
                if not _looks_cf(p): return p
            if parts: return parts[0]
        xri=(self.headers.get("X-Real-IP") or "").strip()
        if xri:
            return xri.split(",")[0].strip()
        return self.client_address[0] if self.client_address else ""
    def handle_gapi(self, method):
        path,_=self.route()
        if not path.startswith("/gapi"):
            self.send_json(404, {"error":"not found"}); return
        rest=path[len("/gapi"):] or "/"
        if not rest.startswith("/"): rest="/"+rest
        parts=rest.split("/")
        try:
            if ".users" in parts:
                i=parts.index(".users")
                if i+1 < len(parts) and parts[i+1] and not parts[i+1].startswith("."):
                    parts[i+1]=norm_nick(parts[i+1])
                    rest="/".join(parts)
        except Exception: pass
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
        if method=="PUT" and ".users" in rest:
            try:
                segs=[x for x in rest.split("/") if x]
                if len(segs)>=4 and segs[2]==".users":
                    nick=norm_nick(segs[3])
                    if nick and not nick.startswith("."):
                        account_ensure(nick, force_id=0 if nick=="admin" else None)
            except Exception: pass
        extra={}
        inm=self.headers.get("If-None-Match")
        if inm: extra["If-None-Match"]=inm
        im=self.headers.get("If-Match")
        if im: extra["If-Match"]=im
        ctype_send="application/json" if method in ("GET","HEAD","DELETE") else ctype
        code, text=galene(method, gpath, galene_auth, raw, ctype_send, extra)
        if method=="DELETE" and ".users" in rest and code < 400:
            try:
                segs=[x for x in rest.split("/") if x]
                if len(segs)>=4 and segs[2]==".users":
                    account_forget_nick(segs[3])
            except Exception: pass
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
        if path=="/accounts":
            ok,_=self.admin_ok()
            if not ok: self.send_json(401, {"error":"nao autorizado"}); return
            self.send_json(200, load_accounts()); return
        if path=="/must-change":
            user=norm_nick((q.get("user") or [""])[0])
            d=load_accounts()
            uid=d["by_nick"].get(user)
            must=False
            if uid is not None:
                rec=d["by_id"].get(str(uid)) or {}
                must=bool(rec.get("must_change"))
            self.send_json(200, {"user":user,"must_change":must}); return
        if path=="/access-log":
            ok,_=self.admin_ok()
            if not ok: self.send_json(401, {"error":"nao autorizado"}); return
            try: lim=int((q.get("limit") or ["300"])[0])
            except Exception: lim=300
            lim=max(1, min(lim, 2000))
            self.send_json(200, {"entries": read_access_log(lim)}); return
        if path=="/rooms":
            rooms=[]
            d=load()
            for fp in sorted(GROUPS.glob("*.json")):
                try: g=json.loads(fp.read_text(encoding="utf-8"))
                except Exception: continue
                pw=(g.get("wildcard-user") or {}).get("password")
                info=ttl_info(fp.stem, d.get(fp.stem) or {})
                rooms.append({"id":fp.stem,"title":g.get("displayName") or fp.stem,"public":bool(g.get("public")),
                    "open": (not pw) or (isinstance(pw, dict) and pw.get("type")=="wildcard"),
                    "updated": datetime.fromtimestamp(fp.stat().st_mtime, TZ).isoformat(timespec="seconds"),
                    "ttl": bool(info.get("ttl")), "expires_at": info.get("expires_at"),
                    "remaining_s": info.get("remaining_s"), "host": info.get("host"), "kind": info.get("kind")})
            self.send_json(200, rooms); return
        if path=="/temp-status":
            g=(q.get("group") or ["spartan"])[0]; user=norm_nick((q.get("user") or [""])[0])
            d=load(); b=bucket(d,g); info=ttl_info(g, b)
            out={"open":is_open(g),"purge":int(b.get("purge") or 0),"banned":ip_banned(b,self.cip()),
                "taken": user in named(g) or user in (b.get("pending") or {}) or user in (b.get("denied") or {}) or user in (b.get("blocked") or {})}
            out.update(info)
            self.send_json(200, out)
            return
        if path=="/status":
            g=(q.get("group") or ["spartan"])[0]; user=norm_nick((q.get("user") or [""])[0]); b=bucket(load(), g)
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
        g=(body.get("group") or "spartan").strip() or "spartan"; user=norm_nick(body.get("user") or "")
        if path=="/beacon":
            if not ok_nick(user): self.send_json(400, {"error":"nick invalido"}); return
            d=load(); b=bucket(d,g); t=now(); ip=self.cip()
            if ip_banned(b, ip): self.send_json(403, {"error":"IP suspenso nesta sala por 24h"}); return
            rec=b.setdefault("seen",{}).setdefault(user, {"first":t,"last":t,"ip":ip}); rec["last"]=t; rec["ip"]=ip
            if user in named(g):
                access_log("cadastrado", g, user, ip)
                save(d); self.send_json(200, {"ok":True,"named":True}); return
            if is_open(g):
                ensure_open_ouvinte(g)
                rec=b.setdefault("temps",{}).setdefault(user, {"first":t,"last":t,"ip":ip}); rec["last"]=t; rec["ip"]=ip
                access_log("temporario", g, user, ip)
            else:
                rec=b["guests"].setdefault(user, {"first":t,"last":t,"ip":ip}); rec["last"]=t; rec["ip"]=ip
                access_log("convidado", g, user, ip)
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
            access_log("pedido_cadastro", g, user, self.cip())
            self.send_json(200, {"ok":True}); return
        if path=="/panel-login":
            u=norm_nick(body.get("user") or user or "")
            pw=body.get("password") if "password" in body else body.get("pass")
            if pw is None: pw=""
            if panel_login_ok(u, pw):
                access_log("painel_admin", "painel", u, self.cip())
                self.send_json(200, {"ok":True})
            else:
                self.send_json(401, {"error":"Usuário ou senha inválidos. Use a conta admin da sala principal, não a senha de amigos nem o anfitrião temporário."})
            return
        if path=="/can-panel":
            u=norm_nick(body.get("user") or user or "")
            pw=body.get("password") if "password" in body else body.get("pass")
            if pw is None: pw=""
            self.send_json(200, {"ok": panel_login_ok(u, pw)})
            return
        if path=="/join-named":
            pw=body.get("password") or ""
            gid=(body.get("group") or g).strip() or "spartan"
            if not ok_nick(user) or not pw:
                self.send_json(400, {"error":"usuario e senha obrigatorios"}); return
            if not (GROUPS/f"{gid}.json").exists():
                self.send_json(404, {"error":"sala nao existe"}); return
            real, rec=find_group_user(gid, user)
            if real:
                if password_match(rec.get("password"), pw) or galene_user_auth_ok(gid, real, pw):
                    self.send_json(200, {"ok":True,"role": user_perm_name_from(rec) or "present"}); return
                self.send_json(401, {"error":"senha incorreta"}); return
            main=main_id()
            mreal, mrec=find_group_user(main, user)
            if not mreal:
                self.send_json(401, {"error":"conta nao encontrada. Use o nick da sua conta cadastrada."}); return
            if not (password_match(mrec.get("password"), pw) or galene_user_auth_ok(main, mreal, pw)):
                self.send_json(401, {"error":"senha incorreta"}); return
            ia=internal_auth()
            if not ia:
                self.send_json(500, {"error":"sidecar.auth ausente"}); return
            qg,qu=quote(gid,safe=""), quote(user,safe="")
            galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}", ia, '{"permissions":"present"}')
            galene("POST", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", ia, pw, "text/plain")
            harden_group(gid)
            self.send_json(200, {"ok":True,"role":"present"}); return
        if path=="/first-setup":
            # Primeiro login: troca senha do admin + senha de convidados da sala principal
            u=norm_nick(body.get("user") or "")
            old=body.get("old") or body.get("password") or ""
            new_admin=body.get("admin_password") or body.get("new") or ""
            new_friends=body.get("friends_password") or body.get("room_password") or ""
            if not ok_nick(u) or len(new_admin)<8 or len(new_friends)<8:
                self.send_json(400, {"error":"senha minimo 8"}); return
            if new_admin==old or new_friends==old or new_admin=="Mudar@123" or new_friends=="Mudar@123":
                self.send_json(400, {"error":"escolha senhas novas (diferentes de Mudar@123)"}); return
            if not panel_login_ok(u, old):
                self.send_json(401, {"error":"senha atual invalida"}); return
            d=load_accounts()
            uid=d["by_nick"].get(u)
            if uid is None:
                self.send_json(404, {"error":"conta nao encontrada"}); return
            rec=d["by_id"].get(str(uid)) or {}
            if not rec.get("must_change"):
                self.send_json(400, {"error":"ja configurado"}); return
            site=load_site(); main=site.get("main") or "spartan"
            ia=internal_auth()
            if not ia:
                self.send_json(500, {"error":"sidecar.auth ausente"}); return
            qg,qu=quote(main,safe=""), quote(u,safe="")
            # senha do admin na sala
            code,err=galene("POST", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", ia, new_admin, "text/plain")
            if code>=400: self.send_json(code, {"error":(err or "")[:200]}); return
            harden_group(main)
            # senha dos convidados
            try: galene("PUT", f"/galene-api/v0/.groups/{qg}/.wildcard-user", ia, '{"permissions":"present"}')
            except Exception: pass
            code2,err2=galene("POST", f"/galene-api/v0/.groups/{qg}/.wildcard-user/.password", ia, new_friends, "text/plain")
            if code2>=400: self.send_json(code2, {"error":(err2 or "")[:200]}); return
            harden_group(main)
            # config.json + sidecar.auth
            cfgp=Path("/data/config.json")
            if cfgp.exists():
                try:
                    cfg=json.loads(cfgp.read_text(encoding="utf-8"))
                    users=cfg.setdefault("users", {})
                    urec=users.get(u) or {"permissions":"admin"}
                    urec["password"]=hash_plain(new_admin)
                    urec["permissions"]=urec.get("permissions") or "admin"
                    users[u]=urec
                    cfg["users"]=users
                    cfgp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False)+chr(10), encoding="utf-8")
                except Exception: pass
            Path("/data/sidecar.auth").write_text(f"{u}:{new_admin}\n", encoding="utf-8")
            try: os.chmod("/data/sidecar.auth", 0o600)
            except Exception: pass
            rec["must_change"]=False
            rec["setup_at"]=now()
            d["by_id"][str(uid)]=rec
            save_accounts(d)
            self.send_json(200, {"ok":True}); return
        ok,auth=self.admin_ok()
        if not ok: self.send_json(401, {"error":"nao autorizado"}); return
        if path=="/create-room":
            slug=(body.get("id") or body.get("slug") or "").strip().lower()
            if not slug_ok(slug):
                self.send_json(400, {"error":"nome da sala invalido"}); return
            if slug==main_id() or (GROUPS/f"{slug}.json").exists():
                self.send_json(409, {"error":"essa sala ja existe"}); return
            title=(body.get("title") or slug).strip() or slug
            open_room=bool(body.get("open") or body.get("public"))
            friends=body.get("friends_password") or body.get("password") or ""
            if not open_room and len(friends)<8:
                self.send_json(400, {"error":"senha de convite minimo 8"}); return
            want_host=bool(body.get("host"))
            host_nick=norm_nick(body.get("host_nick") or body.get("host_user") or "")
            host_pw=body.get("host_password") or ""
            if want_host:
                if not ok_nick(host_nick) or len(host_pw)<8:
                    self.send_json(400, {"error":"anfitriao precisa de nick e senha (minimo 8)"}); return
                if host_nick in named(main_id()):
                    self.send_json(409, {"error":"esse nick ja e conta da sala principal; escolhe outro para o anfitriao"}); return
            ia=internal_auth()
            if not ia:
                self.send_json(500, {"error":"sidecar.auth ausente"}); return
            qg=quote(slug, safe="")
            desc={"public":True,"displayName":title,"description":"","codecs":["vp9","vp8","opus"],"unrestricted-tokens":True}
            code,err=galene("PUT", f"/galene-api/v0/.groups/{qg}/", ia, json.dumps(desc), "application/json", {"If-None-Match":"*"})
            if code>=400:
                self.send_json(code, {"error":(err or "nao criou a sala")[:220]}); return
            wild_perm=["present"] if open_room else "present"
            galene("PUT", f"/galene-api/v0/.groups/{qg}/.wildcard-user", ia, json.dumps({"permissions":wild_perm}))
            if open_room:
                galene("PUT", f"/galene-api/v0/.groups/{qg}/.wildcard-user/.password", ia, json.dumps({"type":"wildcard"}))
            else:
                galene("POST", f"/galene-api/v0/.groups/{qg}/.wildcard-user/.password", ia, friends, "text/plain")
            host_saved=None
            if want_host:
                qu=quote(host_nick, safe="")
                galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}", ia, json.dumps({"permissions":"op"}))
                galene("POST", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", ia, host_pw, "text/plain")
                host_saved=host_nick
            harden_group(slug)
            ttl=set_ttl(slug, "public" if open_room else "invite", host_saved)
            self.send_json(200, {"ok":True,"id":slug,"ttl":ttl}); return
        if path=="/site-home":
            gid=(body.get("group") or "").strip()
            if not (GROUPS/f"{gid}.json").exists(): self.send_json(404, {"error":"sala nao existe"}); return
            info=ttl_info(gid)
            if info.get("ttl"):
                self.send_json(400, {"error":"sala de 24h nao pode ser a home"}); return
            st=load_site(); st["home"]=gid; save_site(st); self.send_json(200, st); return
        if path=="/rename-user":
            new_nick=norm_nick(body.get("nick") or body.get("new") or "")
            uid=body.get("id")
            old=norm_nick(body.get("user") or body.get("old") or "")
            if uid is None and old:
                acc=load_accounts()
                if old in acc["by_nick"]: uid=acc["by_nick"][old]
            if uid is None: self.send_json(400, {"error":"id ou user obrigatorio"}); return
            try: uid=int(uid)
            except Exception: self.send_json(400, {"error":"id invalido"}); return
            ok2, info=account_rename(uid, new_nick)
            if not ok2: self.send_json(409, {"error":info}); return
            old_nick=info if isinstance(info,str) else old
            for fp in GROUPS.glob("*.json"):
                rename_galene_user(fp.stem, old_nick or old, new_nick, auth)
            d=load()
            for gid,b in list(d.items()):
                if not isinstance(b, dict): continue
                for k in ("guests","pending","denied","blocked","temps","created","seen"):
                    bag=b.get(k) or {}
                    if old_nick in bag and old_nick!=new_nick:
                        bag[new_nick]=bag.pop(old_nick)
            save(d)
            cfgp=Path("/data/config.json")
            if cfgp.exists() and old_nick:
                try:
                    cfg=json.loads(cfgp.read_text(encoding="utf-8"))
                    users=cfg.get("users") or {}
                    if old_nick in users and new_nick not in users:
                        users[new_nick]=users.pop(old_nick)
                        cfg["users"]=users
                        cfgp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False)+chr(10), encoding="utf-8")
                except Exception: pass
            self.send_json(200, {"ok":True,"id":uid,"nick":new_nick,"old":old_nick}); return
        if path=="/rename-main":
            st=load_site(); old=st["main"]; title=(body.get("title") or "").strip()
            nid=(body.get("id") or old).strip().lower()
            if not slug_ok(nid): self.send_json(400, {"error":"nome de URL invalido"}); return
            op,np=GROUPS/f"{old}.json", GROUPS/f"{nid}.json"
            if not op.exists(): self.send_json(404, {"error":"sala principal sumiu"}); return
            gj=json.loads(op.read_text(encoding="utf-8"))
            if title: gj["displayName"]=title
            if nid!=old:
                if np.exists(): self.send_json(409, {"error":"ja existe uma sala com esse nome"}); return
                np.write_text(json.dumps(gj, indent=2, ensure_ascii=False)+chr(10), encoding="utf-8")
                op.unlink()
                d=load()
                if old in d: d[nid]=d.pop(old); save(d)
                if st.get("home")==old: st["home"]=nid
                st["main"]=nid
            else:
                op.write_text(json.dumps(gj, indent=2, ensure_ascii=False)+chr(10), encoding="utf-8")
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
            account_ensure(user)
            b["pending"].pop(user,None); b["denied"].pop(user,None); b["blocked"].pop(user,None); b["guests"].pop(user,None)
            b.setdefault("created",{})[user]=now(); save(d)
            access_log("conta_aprovada", g, user, self.cip())
            self.send_json(200, {"ok":True}); return
        if path=="/quick":
            pw=body.get("password") or ""; perm=body.get("permissions") or "present"
            if len(pw)<8: self.send_json(400, {"error":"senha minimo 8"}); return
            galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}", auth, json.dumps({"permissions":perm}))
            galene("POST", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", auth, pw, "text/plain")
            harden_group(g)
            account_ensure(user)
            b["pending"].pop(user,None); b["denied"].pop(user,None); b["blocked"].pop(user,None); b["guests"].pop(user,None)
            b.setdefault("created",{})[user]=now(); save(d)
            access_log("conta_criada", g, user, self.cip())
            self.send_json(200, {"ok":True}); return
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
            account_forget_nick(user)
            save(d); self.send_json(200, {"ok":True}); return
        self.send_json(404, {"error":"not found"})

if __name__=="__main__":
    try: account_ensure("admin", force_id=0)
    except Exception: pass
    try: ensure_public_ttl()
    except Exception: pass
    Thread(target=expire_loop, daemon=True).start()
    print("spartan-reg on", PORT, flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
