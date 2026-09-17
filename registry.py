#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote, unquote
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from threading import Thread, Lock
import json, secrets, time, urllib.request, urllib.error, base64, os, hashlib, hmac, string, re

DATA, GROUPS, GALENE, PORT = Path("/data/registry.json"), Path("/groups"), "http://127.0.0.1:8443", 8091
FACTORY_PASSWORD="Mudar@123"
SITE=Path("/data/site.json")
ACCOUNTS=Path("/data/accounts.json")
ACCESS_LOG=Path("/data/access.log")
NET_LOG=Path("/data/net.log")
SERVERS=Path("/data/servers.json")
CHAT_FILES=Path("/data/chat-files")
CHAT_FILE_MAX=100*1024*1024
TZ = ZoneInfo("America/Sao_Paulo")
BAN_IP = False
_ACCESS_WRITE = 0
_NET_WRITE = 0
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

PRESENCE_STALE_S = 45
# Reentrada do mesmo nick: mantém o timer individual.
PRESENCE_USER_GRACE_S = 60
# Sala vazia: continua contando; depois disto para e zera.
PRESENCE_ROOM_EMPTY_GRACE_S = 300
# Compat: código antigo usava este nome para graça de usuário.
PRESENCE_GRACE_S = PRESENCE_USER_GRACE_S
_GALENE_COUNTS = {"t": 0.0, "data": None}

def parse_iso(ts):
    if not ts:
        return None
    try:
        d = datetime.fromisoformat(ts)
        if d.tzinfo is None:
            d = d.replace(tzinfo=TZ)
        return d
    except Exception:
        return None

def live_bucket(b):
    live = b.setdefault("live", {})
    live.setdefault("users", {})
    return live

def user_presence_online(rec, tnow):
    if not rec:
        return False
    if rec.get("offline_since"):
        return False
    last = parse_iso(rec.get("last"))
    if not last:
        return False
    return (tnow - last).total_seconds() <= PRESENCE_STALE_S

def presence_online_count(b, tnow):
    users = (b.get("live") or {}).get("users") or {}
    return sum(1 for rec in users.values() if user_presence_online(rec, tnow))

def _room_reset(live):
    live.pop("room_accum_s", None)
    live.pop("room_tick_since", None)
    live.pop("room_since", None)
    live.pop("empty_since", None)

def presence_prune_room(b, tnow, gid=None):
    """Ocupação da sala: gente na call inicia o relógio; 5 min vazia para e zera."""
    live = live_bucket(b)
    users = live.get("users") or {}
    online = 0
    for nick, rec in list(users.items()):
        if user_presence_online(rec, tnow):
            online += 1
        else:
            last = parse_iso(rec.get("last"))
            off = parse_iso(rec.get("offline_since"))
            if not off and last and (tnow - last).total_seconds() > PRESENCE_STALE_S:
                rec["offline_since"] = tnow.isoformat(timespec="seconds")
                users[nick] = rec
            off2 = parse_iso(rec.get("offline_since"))
            if off2 and (tnow - off2).total_seconds() > PRESENCE_USER_GRACE_S:
                users.pop(nick, None)
    live["users"] = users
    # tick/accum antigo inflava o relógio (ex.: 15 h com a sala recém-aberta)
    live.pop("room_tick_since", None)
    live.pop("room_accum_s", None)

    occupied = online > 0
    if gid:
        counts = galene_group_counts_cached()
        if counts is not None:
            occupied = occupied or (counts.get(gid, 0) > 0)

    room_since = parse_iso(live.get("room_since"))
    empty_since = parse_iso(live.get("empty_since"))

    if occupied:
        if empty_since:
            gap = (tnow - empty_since).total_seconds()
            live.pop("empty_since", None)
            if gap > PRESENCE_ROOM_EMPTY_GRACE_S:
                room_since = tnow
        if not room_since:
            room_since = tnow
        live["room_since"] = room_since.isoformat(timespec="seconds")
    else:
        if room_since:
            if not empty_since:
                empty_since = tnow
                live["empty_since"] = tnow.isoformat(timespec="seconds")
            if (tnow - empty_since).total_seconds() > PRESENCE_ROOM_EMPTY_GRACE_S:
                _room_reset(live)
        else:
            live.pop("empty_since", None)
    return online

def presence_heartbeat(b, user, tnow=None, gid=None):
    tnow = tnow or datetime.now(TZ)
    user = norm_nick(user)
    if not user:
        return
    live = live_bucket(b)
    users = live.setdefault("users", {})
    rec = users.get(user) or {}
    was_on = user_presence_online(rec, tnow)
    off_since = parse_iso(rec.get("offline_since"))
    since = parse_iso(rec.get("since"))
    if not was_on:
        if off_since and since and (tnow - off_since).total_seconds() < PRESENCE_USER_GRACE_S:
            pass  # mesma sessão individual
        else:
            rec["since"] = tnow.isoformat(timespec="seconds")
    elif not since:
        rec["since"] = tnow.isoformat(timespec="seconds")
    rec["last"] = tnow.isoformat(timespec="seconds")
    rec.pop("offline_since", None)
    users[user] = rec
    presence_prune_room(b, tnow, gid=gid)

def presence_leave(b, user, tnow=None, gid=None):
    tnow = tnow or datetime.now(TZ)
    user = norm_nick(user)
    if not user:
        return
    live = live_bucket(b)
    users = live.get("users") or {}
    rec = users.get(user)
    if rec:
        rec["last"] = tnow.isoformat(timespec="seconds")
        rec["offline_since"] = tnow.isoformat(timespec="seconds")
        users[user] = rec
    presence_prune_room(b, tnow, gid=gid)

def room_live_seconds(b, tnow=None, gid=None):
    """Tempo da sessão da sala. Ativo com gente na call ou nos 5 min após esvaziar."""
    tnow = tnow or datetime.now(TZ)
    presence_prune_room(b, tnow, gid=gid)
    live = b.get("live") or {}
    since = parse_iso(live.get("room_since"))
    if not since:
        return 0, False
    return max(0, int((tnow - since).total_seconds())), True

def user_live_seconds(b, user, tnow=None):
    """Tempo individual na sala (autoridade do servidor)."""
    tnow = tnow or datetime.now(TZ)
    user = norm_nick(user)
    live = b.get("live") or {}
    rec = (live.get("users") or {}).get(user)
    if not rec:
        return 0, False, False
    since = parse_iso(rec.get("since"))
    if not since:
        return 0, False, user_presence_online(rec, tnow)
    online = user_presence_online(rec, tnow)
    off_since = parse_iso(rec.get("offline_since"))
    if online:
        return int((tnow - since).total_seconds()), True, True
    if off_since and (tnow - off_since).total_seconds() <= PRESENCE_USER_GRACE_S:
        return int((tnow - since).total_seconds()), True, False
    return 0, False, False

def presence_user_state(b, user, tnow=None):
    tnow = tnow or datetime.now(TZ)
    ls, active, online = user_live_seconds(b, user, tnow)
    return {"live_s": ls, "active": active, "online": online, "server_ts": tnow.isoformat(timespec="seconds")}

def galene_group_counts():
    auth = internal_auth()
    if not auth:
        return None
    code, text = galene("GET", "/galene-api/v0/.stats", auth)
    if code != 200:
        return None
    try:
        data = json.loads(text)
        out = {}
        for g in data:
            name = g.get("name")
            if not name:
                continue
            clients = g.get("clients") or []
            out[name] = len(clients)
        return out
    except Exception:
        return None

def galene_group_counts_cached(ttl=4):
    nowm = time.time()
    prev = _GALENE_COUNTS.get("data")
    if prev is not None and (nowm - (_GALENE_COUNTS.get("t") or 0)) < ttl:
        return prev
    data = galene_group_counts()
    _GALENE_COUNTS["t"] = nowm
    _GALENE_COUNTS["data"] = data
    return data
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
def net_log(rec):
    """Append JSONL em /data/net.log (retenção 30 dias). Sem dedupe — cada queda conta."""
    global _NET_WRITE
    try:
        NET_LOG.parent.mkdir(parents=True, exist_ok=True)
        with NET_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False)+"\n")
        _NET_WRITE += 1
        if _NET_WRITE % 40 == 0:
            prune_net_log()
    except Exception:
        pass
def prune_net_log():
    if not NET_LOG.exists(): return
    try:
        cutoff=datetime.now(TZ)-timedelta(days=30)
        keep=[]
        with NET_LOG.open("r", encoding="utf-8", errors="replace") as f:
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
        tmp=NET_LOG.with_suffix(".tmp")
        tmp.write_text(("\n".join(keep)+("\n" if keep else "")), encoding="utf-8")
        tmp.replace(NET_LOG)
    except Exception:
        pass
def read_net_log(limit=400):
    if not NET_LOG.exists(): return []
    try:
        lines=NET_LOG.read_text(encoding="utf-8", errors="replace").splitlines()
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
def random_room_slug(n=15):
    alphabet=string.ascii_lowercase + string.digits
    for _ in range(200):
        s="".join(secrets.choice(alphabet) for _ in range(n))
        if slug_ok(s) and not (GROUPS/f"{s}.json").exists():
            return s
    return secrets.token_urlsafe(12).lower().replace("_","").replace("-","")[:n]
_SAVE_LOCK = Lock()
_SERVER_LOCK = Lock()
def load_unlocked():
    if not DATA.exists():
        return {}
    try:
        return json.loads(DATA.read_text(encoding="utf-8"))
    except Exception:
        return {}
def save_unlocked(d):
    DATA.parent.mkdir(parents=True, exist_ok=True)
    payload=json.dumps(d, indent=2, ensure_ascii=False)
    t=DATA.with_suffix(".tmp"); t.write_text(payload, encoding="utf-8"); t.replace(DATA)
def load():
    with _SAVE_LOCK:
        return load_unlocked()
def save(d):
    with _SAVE_LOCK:
        save_unlocked(d)
def mutate_registry(fn):
    """Leitura-modificação-gravação atômica do registry.json."""
    with _SAVE_LOCK:
        d=load_unlocked()
        r=fn(d)
        save_unlocked(d)
        return r
SERVER_VOICE_LIMIT=12
SERVER_TEXT_KEEP=200
CHAT_FILE_KINDS={
    "image/png": ("png", "image"),
    "image/jpeg": ("jpg", "image"),
    "image/gif": ("gif", "image"),
    "image/webp": ("webp", "image"),
    "video/mp4": ("mp4", "video"),
    "audio/mpeg": ("mp3", "audio"),
    "audio/mp3": ("mp3", "audio"),
}
def sniff_chat_file(data, ctype, filename):
    data=data or b""
    ctype=(ctype or "").split(";")[0].strip().lower()
    name=(filename or "").lower()
    if data.startswith(b"\x89PNG"): return "image/png", "png", "image"
    if data[:3]==b"\xff\xd8\xff": return "image/jpeg", "jpg", "image"
    if data.startswith(b"GIF8"): return "image/gif", "gif", "image"
    if len(data)>=12 and data[:4]==b"RIFF" and data[8:12]==b"WEBP": return "image/webp", "webp", "image"
    if b"ftyp" in data[:12]: return "video/mp4", "mp4", "video"
    if data.startswith(b"ID3") or (len(data)>=2 and data[0]==0xFF and data[1] in (0xFB, 0xF3, 0xF2)):
        return "audio/mpeg", "mp3", "audio"
    if ctype in CHAT_FILE_KINDS:
        ext, kind=CHAT_FILE_KINDS[ctype]
        return ctype, ext, kind
    if name.endswith(".png"): return "image/png", "png", "image"
    if name.endswith(".jpg") or name.endswith(".jpeg"): return "image/jpeg", "jpg", "image"
    if name.endswith(".gif"): return "image/gif", "gif", "image"
    if name.endswith(".webp"): return "image/webp", "webp", "image"
    if name.endswith(".mp4"): return "video/mp4", "mp4", "video"
    if name.endswith(".mp3"): return "audio/mpeg", "mp3", "audio"
    return None
def parse_multipart(handler):
    ctype=handler.headers.get("Content-Type") or ""
    if "multipart/form-data" not in ctype: return None, None
    n=int(handler.headers.get("Content-Length") or 0)
    if n<=0 or n>CHAT_FILE_MAX+65536: return None, None
    raw=handler.rfile.read(n)
    m=re.search(r'boundary=([^;]+)', ctype)
    if not m: return None, None
    boundary=m.group(1).strip().strip('"').encode()
    fields={}; filepart=None
    for part in raw.split(b"--"+boundary):
        if not part or part in (b"--", b"--\r\n", b"\r\n"): continue
        if part.startswith(b"--"): continue
        if part.startswith(b"\r\n"): part=part[2:]
        head, sep, body = part.partition(b"\r\n\r\n")
        if not sep: continue
        if body.endswith(b"\r\n"): body=body[:-2]
        hs=head.decode("utf-8", "replace")
        nm=re.search(r'name="([^"]+)"', hs)
        if not nm: continue
        name=nm.group(1)
        fn=re.search(r'filename="([^"]*)"', hs)
        if fn:
            cm=re.search(r"Content-Type:\s*([^\r\n]+)", hs, re.I)
            filepart={"filename": fn.group(1), "data": body, "ctype": (cm.group(1).strip() if cm else "")}
        else:
            fields[name]=body.decode("utf-8", "replace")
    return fields, filepart
def servers_http_file_get(handler, q):
    fid=((q.get("id") or [""])[0] or "").strip()
    sid=((q.get("server") or [""])[0] or "").strip().lower()
    nick=norm_nick((q.get("user") or [""])[0])
    if not fid or not sid:
        handler.send_json(400, {"error":"arquivo invalido"}); return True
    s=get_server(sid)
    if not s:
        handler.send_json(404, {"error":"servidor nao existe"}); return True
    rec=((s.get("files") or {}).get(fid)) or {}
    if not rec:
        handler.send_json(404, {"error":"arquivo nao existe"}); return True
    ch=find_channel(s, rec.get("channel"))
    if not server_can_enter(s, nick, ch):
        handler.send_json(403, {"error":"sem acesso a este arquivo"}); return True
    ext=rec.get("ext") or "bin"
    fp=CHAT_FILES/sid/f"{fid}.{ext}"
    if not fp.exists():
        handler.send_json(404, {"error":"arquivo nao existe"}); return True
    data=fp.read_bytes()
    handler.send_raw(200, data, rec.get("mime") or "application/octet-stream")
    return True
def servers_http_file_post(handler):
    fields, filepart = parse_multipart(handler)
    if not fields or not filepart:
        handler.send_json(400, {"error":"envie o arquivo no formulario"}); return
    user=norm_nick(fields.get("user") or "")
    pw=fields.get("password") if "password" in fields else (fields.get("pass") or "")
    if pw is None: pw=""
    sid=(fields.get("server") or fields.get("id") or "").strip().lower()
    cid=(fields.get("channel") or "").strip().lower()
    if not ok_nick(user) or not server_cred_ok(user, pw):
        handler.send_json(401, {"error":"nao autorizado"}); return
    s=get_server(sid)
    ch=find_channel(s, cid) if s else None
    if not s or not ch or ch.get("kind")!="text":
        handler.send_json(404, {"error":"canal de texto nao existe"}); return
    if not server_can_enter(s, user, ch):
        handler.send_json(403, {"error":"sem acesso a este canal"}); return
    if server_member_role(s, user)=="guest":
        handler.send_json(403, {"error":"ouvinte nao envia arquivo"}); return
    data=filepart.get("data") or b""
    if not data:
        handler.send_json(400, {"error":"arquivo vazio"}); return
    if len(data)>CHAT_FILE_MAX:
        handler.send_json(413, {"error":"arquivo passa de 100 MB"}); return
    sniffed=sniff_chat_file(data, filepart.get("ctype"), filepart.get("filename"))
    if not sniffed:
        handler.send_json(400, {"error":"so imagem, mp4 ou mp3"}); return
    mime, ext, kind=sniffed
    fid=secrets.token_urlsafe(16).replace("_","").replace("-","")[:22]
    dest_dir=CHAT_FILES/sid
    dest_dir.mkdir(parents=True, exist_ok=True)
    (dest_dir/f"{fid}.{ext}").write_bytes(data)
    caption=(fields.get("text") or "").strip()[:2000]
    fname=(filepart.get("filename") or ("arquivo."+ext))[:120]
    def _save(doc):
        srv=(doc.get("servers") or {}).get(sid)
        if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
        files=srv.setdefault("files", {})
        files[fid]={"channel":cid,"nick":user,"name":fname,"mime":mime,"ext":ext,"kind":kind,"size":len(data),"at":now()}
        bag=srv.setdefault("text", {})
        msgs=bag.setdefault(cid, [])
        msg={"at":now(),"nick":user,"text":caption,"file":{"id":fid,"name":fname,"mime":mime,"kind":kind,"size":len(data)}}
        msgs.append(msg)
        if len(msgs)>SERVER_TEXT_KEEP:
            del msgs[:-SERVER_TEXT_KEEP]
        here=srv.setdefault("here", {})
        here[user]={"channel":cid,"at":now(),"kind":"text"}
        return {"ok":True,"message":msg}
    out=mutate_servers(_save)
    if isinstance(out, dict) and out.get("_http"):
        code,payload=out["_http"]; handler.send_json(code, payload); return
    handler.send_json(200, out)
DEFAULT_SERVER_CATS=(
    {"id":"texto","title":"Canais de texto"},
    {"id":"voz","title":"Canais de voz"},
)
def channels_text_then_voice(chans):
    texts=[c for c in (chans or []) if (c.get("kind") or "voice")=="text"]
    voices=[c for c in (chans or []) if (c.get("kind") or "voice")!="text"]
    return texts+voices
def load_servers_unlocked():
    if not SERVERS.exists():
        return {"servers":{}}
    try:
        raw=json.loads(SERVERS.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("servers"), dict):
            return raw
    except Exception:
        pass
    return {"servers":{}}
def save_servers_unlocked(d):
    SERVERS.parent.mkdir(parents=True, exist_ok=True)
    t=SERVERS.with_suffix(".tmp")
    t.write_text(json.dumps(d, indent=2, ensure_ascii=False)+chr(10), encoding="utf-8")
    t.replace(SERVERS)
def mutate_servers(fn):
    with _SERVER_LOCK:
        d=load_servers_unlocked()
        r=fn(d)
        save_servers_unlocked(d)
        return r
def server_invite_code():
    return secrets.token_urlsafe(12).replace("_","").replace("-","")[:16]
CHAN_SEP="__"
def channel_key(cid, sid=None):
    cid=(cid or "").strip().lower()
    if not cid: return ""
    if sid:
        p=str(sid).strip().lower()+CHAN_SEP
        if cid.startswith(p): return cid[len(p):]
    if CHAN_SEP in cid:
        return cid.split(CHAN_SEP, 1)[-1]
    return cid
def channel_uid(sid, key):
    sid=(sid or "").strip().lower()
    key=channel_key(key, sid)
    if not sid or not key: return key
    return sid+CHAN_SEP+key
LOCKED_CHANNEL_KEYS=frozenset(("geral","voz-1","ausentes"))
def channel_preset_key(ch, sid=None):
    if not ch: return ""
    return (ch.get("key") or channel_key(ch.get("id"), sid) or "").strip().lower()
def channel_is_locked(ch, sid=None):
    k=channel_preset_key(ch, sid)
    if k in LOCKED_CHANNEL_KEYS: return True
    return bool(ch and ch.get("locked"))
def stamp_channel_flags(c, sid, voz1_group=None):
    k=channel_preset_key(c, sid)
    if k in ("lobby","voz-1") or c.get("id") in ("lobby","voz-1"):
        k="voz-1"
        c["key"]="voz-1"; c["id"]=channel_uid(sid,"voz-1")
        if voz1_group: c["group"]=voz1_group
        t=(c.get("title") or "").strip()
        if not t or t in ("Lobby","lobby"): c["title"]="Voz 1"
        c["kind"]="voice"; c["category"]="voz"; c["locked"]=True
    elif k=="geral" or c.get("id")=="geral":
        c["key"]="geral"; c["id"]=channel_uid(sid,"geral")
        t=(c.get("title") or "").strip()
        if not t or t=="Geral": c["title"]="Chat Geral"
        c["kind"]="text"; c["category"]="texto"; c["locked"]=True
    elif k=="ausentes" or c.get("id")=="ausentes":
        c["key"]="ausentes"; c["id"]=channel_uid(sid,"ausentes")
        if not (c.get("title") or "").strip(): c["title"]="Ausentes"
        c["kind"]="voice"; c["category"]="voz"; c["afk"]=True; c["locked"]=True
    elif k in ("voz-2","voz-3"):
        c["key"]=k; c["id"]=channel_uid(sid, k)
        c["kind"]="voice"; c["category"]="voz"; c["locked"]=False
    return c
def channel_index(chans, sid=None):
    out={}
    for c in chans or []:
        k=c.get("key") or channel_key(c.get("id"), sid)
        if k: out[k]=c
    return out
def bind_server_channel_ids(s):
    sid=(s.get("id") or "").strip().lower()
    if not sid: return s
    chans=s.setdefault("channels", [])
    remap={}
    for c in chans:
        old=(c.get("id") or "").strip().lower()
        key=(c.get("key") or channel_key(old, sid) or old).strip().lower()
        if not key: continue
        uid=channel_uid(sid, key)
        c["key"]=key
        if old and old!=uid:
            remap[old]=uid
        c["id"]=uid
    text=s.setdefault("text", {})
    for old, new in list(remap.items()):
        if old in text and new not in text:
            text[new]=text.pop(old)
        elif old in text:
            text.pop(old, None)
    for bag in (s.get("here") or {}, s.get("reloc") or {}):
        for rec in bag.values():
            if isinstance(rec, dict) and rec.get("channel") in remap:
                rec["channel"]=remap[rec["channel"]]
    for rec in (s.get("files") or {}).values():
        if isinstance(rec, dict) and rec.get("channel") in remap:
            rec["channel"]=remap[rec["channel"]]
    return s
def official_server(main):
    return {
        "id": main,
        "title": "Spartan",
        "official": True,
        "owner": "admin",
        "invite": server_invite_code(),
        "created": now(),
        "categories": [dict(c) for c in DEFAULT_SERVER_CATS],
        "channels": [
            {"id":channel_uid(main,"geral"),"key":"geral","title":"Chat Geral","kind":"text","category":"texto","public":True,"locked":True},
            {"id":channel_uid(main,"voz-1"),"key":"voz-1","title":"Voz 1","kind":"voice","category":"voz","group":main,"public":True,"locked":True},
        ],
        "members": {},
        "mods": [],
        "pending": {},
        "here": {},
        "text": {},
        "reloc": {},
        "files": {},
    }
def add_preset_channels(s, voz1_group, create=True):
    """Preset: Chat Geral, Voz 1/2/3, Ausentes. Sem categoria Jogos."""
    s["categories"]=[dict(c) for c in DEFAULT_SERVER_CATS]
    sid=s.get("id") or "sv"
    chans=s.setdefault("channels", [])
    for c in chans:
        if c.get("category")=="jogos":
            c["category"]="voz" if c.get("kind")=="voice" else "texto"
        stamp_channel_flags(c, sid, voz1_group)
    by=channel_index(chans, sid)
    if "geral" not in by:
        chans.append({"id":channel_uid(sid,"geral"),"key":"geral","title":"Chat Geral","kind":"text","category":"texto","public":True,"locked":True})
        by["geral"]=chans[-1]
    if "voz-1" not in by:
        chans.append({"id":channel_uid(sid,"voz-1"),"key":"voz-1","title":"Voz 1","kind":"voice","category":"voz","group":voz1_group,"public":True,"locked":True})
        by["voz-1"]=chans[-1]
    else:
        by["voz-1"]["group"]=voz1_group
        stamp_channel_flags(by["voz-1"], sid, voz1_group)
    for cid, title, afk in (("voz-2","Voz 2", False), ("voz-3","Voz 3", False), ("ausentes","Ausentes", True)):
        if cid in by:
            stamp_channel_flags(by[cid], sid, voz1_group)
            continue
        if not create:
            continue
        slug=None
        want=(sid+"-"+cid).replace("_","-")[:32]
        if slug_ok(want) and not (GROUPS/f"{want}.json").exists():
            slug=want
        else:
            slug=random_room_slug(15)
        ok,_=put_open_voice_group(slug, title)
        if not ok: continue
        ch={"id":channel_uid(sid,cid),"key":cid,"title":title,"kind":"voice","category":"voz","group":slug,"public":True,"locked": cid in LOCKED_CHANNEL_KEYS}
        if afk: ch["afk"]=True
        chans.append(ch)
    s.setdefault("reloc", {})
    bind_server_channel_ids(s)
    s["channels"]=channels_text_then_voice(s.get("channels"))
    return s
def ensure_channel(chans, cid, spec):
    for c in chans:
        if c.get("id")==cid:
            if cid=="lobby":
                c["kind"]="voice"
                c["group"]=spec.get("group")
                c.setdefault("category", spec.get("category") or "voz")
                c.setdefault("title", spec.get("title") or "Lobby")
                c.setdefault("public", True)
            else:
                for k,v in spec.items():
                    c.setdefault(k, v)
            return c
    chans.append(dict(spec))
    return chans[-1]
def ensure_servers():
    with _SERVER_LOCK:
        doc=load_servers_unlocked()
        servers=doc.setdefault("servers", {})
        main=main_id()
        fresh=main not in servers
        if fresh:
            servers[main]=official_server(main)
        else:
            s=servers[main]
            s["official"]=True
            s["id"]=main
            if not s.get("title"): s["title"]="Spartan"
            if not s.get("owner"): s["owner"]="admin"
            if not s.get("invite"): s["invite"]=server_invite_code()
            s.setdefault("members", {})
            s.setdefault("mods", [])
            s.setdefault("pending", {})
            s.setdefault("here", {})
            s.setdefault("text", {})
            s.setdefault("reloc", {})
            s.setdefault("files", {})
        add_preset_channels(servers[main], main, create=fresh)
        for s in servers.values():
            bind_server_channel_ids(s)
        save_servers_unlocked(doc)
        return doc
def get_server(sid):
    doc=ensure_servers()
    return (doc.get("servers") or {}).get((sid or "").strip().lower())
def normalize_invite_code(raw):
    raw=(raw or "").strip()
    if not raw: return ""
    m=re.search(r"[#/](?:i|convidado)/([^/?#]+)", raw, re.I)
    if m:
        return unquote(m.group(1)).strip()
    return raw
def find_server_by_invite(code):
    code=normalize_invite_code(code)
    if not code: return None
    doc=ensure_servers()
    for s in (doc.get("servers") or {}).values():
        if (s.get("invite") or "")==code:
            return s
    return None
def find_channel(s, cid):
    cid=(cid or "").strip().lower()
    if not s or not cid: return None
    sid=s.get("id") or ""
    want=channel_key(cid, sid) or cid
    uid=channel_uid(sid, want) if sid and want else ""
    for c in (s.get("channels") or []):
        if c.get("id")==cid or c.get("id")==uid or c.get("key")==want or c.get("key")==cid:
            return c
        if channel_key(c.get("id"), sid)==want:
            return c
    return None
def find_channel_by_group(gid):
    gid=(gid or "").strip()
    doc=ensure_servers()
    for s in (doc.get("servers") or {}).values():
        for c in s.get("channels") or []:
            if c.get("kind")=="voice" and c.get("group")==gid:
                return s, c
    return None, None
def is_server_voice_group(gid, ids=None):
    """Grupo Galene que é canal de voz de um servidor — não é sala extra do painel."""
    gid=(gid or "").strip()
    if not gid or gid==main_id():
        return False
    if ids is None:
        ids=server_voice_group_ids()
    return gid in ids
def server_voice_group_ids():
    main=main_id()
    out=set()
    for s in (ensure_servers().get("servers") or {}).values():
        for c in s.get("channels") or []:
            g=c.get("group")
            if c.get("kind")=="voice" and g and g!=main:
                out.add(g)
    return out
def is_global_admin_nick(nick):
    return account_get_role(nick) in ("op","admin")
def server_member_role(s, nick):
    nick=norm_nick(nick)
    if not s or not nick: return None
    if is_global_admin_nick(nick): return "admin"
    if nick==norm_nick(s.get("owner") or ""): return "admin"
    mods=[norm_nick(x) for x in (s.get("mods") or [])]
    members=s.get("members") or {}
    rec=members.get(nick) if isinstance(members.get(nick), dict) else None
    if nick in mods or (rec and rec.get("role")=="mod"): return "mod"
    if rec: return rec.get("role") or "member"
    if nick in members: return "member"
    return None
def server_can_manage(s, nick):
    return server_member_role(s, nick) in ("admin","mod")
def server_can_enter(s, nick, ch):
    role=server_member_role(s, nick)
    if not ch: return False
    if not role: return False
    if ch.get("public", True) is False:
        return role in ("admin","mod")
    return role in ("admin","mod","member","guest")
def nick_is_server_mod_any(nick):
    nick=norm_nick(nick)
    if not nick: return False
    doc=ensure_servers()
    for s in (doc.get("servers") or {}).values():
        if server_member_role(s, nick) in ("admin","mod"):
            return True
    return False
def panel_scope_for(nick, password):
    nick=norm_nick(nick)
    if not nick or password is None: return None
    if panel_login_ok(nick, password): return "admin"
    if not server_cred_ok(nick, password): return None
    if nick_is_server_mod_any(nick): return "mod"
    return None
def server_member_list(s):
    out=[]
    seen=set()
    for nick, rec in (s.get("members") or {}).items():
        nick=norm_nick(nick)
        if not nick or nick in seen: continue
        seen.add(nick)
        role=server_member_role(s, nick)
        if not role:
            role=(rec.get("role") if isinstance(rec, dict) else None) or "member"
        out.append({"nick":nick,"role":role})
    for nick in (s.get("mods") or []):
        nick=norm_nick(nick)
        if not nick or nick in seen: continue
        seen.add(nick)
        out.append({"nick":nick,"role":server_member_role(s, nick) or "mod"})
    out.sort(key=lambda x: (0 if x.get("role") in ("admin","mod") else 1, x.get("nick") or ""))
    return out
def list_registered_nicks():
    seen=set()
    out=[]
    d=load_accounts()
    for nick in (d.get("by_nick") or {}):
        nick=norm_nick(nick)
        rec=account_get(nick)
        if nick and rec and rec.get("active", True):
            seen.add(nick)
            out.append(nick)
    main=main_id()
    p=GROUPS/f"{main}.json"
    if p.exists():
        try:
            users=(json.loads(p.read_text(encoding="utf-8")).get("users") or {})
        except Exception:
            users={}
        for nick in users:
            nick=norm_nick(nick)
            if nick and nick not in seen:
                seen.add(nick)
                out.append(nick)
    out.sort()
    return out
def server_kick_nick(srv, nick, by):
    nick=norm_nick(nick)
    if not srv or not nick: return
    (srv.get("members") or {}).pop(nick, None)
    srv["mods"]=[x for x in (srv.get("mods") or []) if norm_nick(x)!=nick]
    (srv.get("here") or {}).pop(nick, None)
    (srv.get("reloc") or {}).pop(nick, None)
    (srv.get("pending") or {}).pop(nick, None)
    srv.setdefault("kicks", {})[nick]={"at":now(),"by":by or ""}
def registered_nicks_without_access(s):
    out=[]
    for nick in list_registered_nicks():
        if server_member_role(s, nick): continue
        out.append(nick)
    return out
def server_add_member_nick(srv, nick):
    nick=norm_nick(nick)
    if not srv or not nick: return
    members=srv.setdefault("members", {})
    rec=members.get(nick)
    if not isinstance(rec, dict):
        members[nick]={"role":"member","joined":now()}
    (srv.get("pending") or {}).pop(nick, None)
    (srv.get("kicks") or {}).pop(nick, None)
def server_can_edit_membership(s, actor, target):
    actor=norm_nick(actor)
    target=norm_nick(target)
    if not s or not actor or not target or actor==target: return False
    if not server_can_manage(s, actor): return False
    if is_global_admin_nick(target): return False
    if target==norm_nick(s.get("owner") or ""): return False
    tr=server_member_role(s, target)
    if tr in ("admin","mod") and not is_global_admin_nick(actor):
        return False
    return True
def server_cred_ok(user, password):
    if not ok_nick(user): return False
    pw=password if password is not None else ""
    if panel_login_ok(user, pw): return True
    if pw and account_verify_password(user, pw): return True
    if presence_auth_ok(main_id(), user, pw): return True
    return False
def unique_slug(title, used, fallback="sala"):
    base="".join(c if c.isalnum() else "-" for c in (title or "").lower()).strip("-")[:32]
    if not slug_ok(base): base=fallback
    s=base; n=2
    while s in used:
        s=(base[:28]+"-"+str(n))[:32]; n+=1
    return s
def put_open_voice_group(slug, title):
    desc={"public":True,"displayName":title,"description":"","codecs":["vp9","vp8","opus"],"unrestricted-tokens":True}
    ia=internal_auth()
    if ia:
        qg=quote(slug, safe="")
        code,err=galene("PUT", f"/galene-api/v0/.groups/{qg}/", ia, json.dumps(desc), "application/json", {"If-None-Match":"*"})
        if code>=400:
            return False, (err or "nao criou o canal")[:220]
        galene("PUT", f"/galene-api/v0/.groups/{qg}/.wildcard-user", ia, json.dumps({"permissions":["present"]}))
        galene("PUT", f"/galene-api/v0/.groups/{qg}/.wildcard-user/.password", ia, json.dumps({"type":"wildcard"}))
        try: harden_group(slug)
        except Exception: pass
        return True, None
    GROUPS.mkdir(parents=True, exist_ok=True)
    body=dict(desc)
    body["wildcard-user"]={"permissions":["present"],"password":{"type":"wildcard"}}
    (GROUPS/f"{slug}.json").write_text(json.dumps(body, indent=2, ensure_ascii=False)+chr(10), encoding="utf-8")
    return True, None
def server_presence_people(s):
    tnow=datetime.now(TZ)
    d=load()
    seen={}
    for ch in s.get("channels") or []:
        if ch.get("kind")!="voice" or not ch.get("group"): continue
        b=d.get(ch["group"]) or {}
        users=((b.get("live") or {}).get("users")) or {}
        for nick, rec in users.items():
            nick=norm_nick(nick)
            if nick and user_presence_online(rec, tnow):
                seen[nick]={"nick":nick,"channel":ch.get("id"),"kind":"voice","title":ch.get("title") or ch.get("id")}
    here=s.get("here") or {}
    for nick, rec in here.items():
        nick=norm_nick(nick)
        if not nick or nick in seen: continue
        last=parse_iso((rec or {}).get("at"))
        if not last or (tnow-last).total_seconds()>PRESENCE_STALE_S: continue
        ch=find_channel(s, (rec or {}).get("channel"))
        if not ch or ch.get("kind")!="text": continue
        seen[nick]={"nick":nick,"channel":ch.get("id"),"kind":"text","title":ch.get("title") or ch.get("id")}
    out=list(seen.values())
    out.sort(key=lambda x: x.get("nick") or "")
    return out
def server_roster(s, people):
    people=people or []
    online=set()
    by={}
    for p in people:
        nick=norm_nick(p.get("nick") or "")
        if not nick: continue
        online.add(nick)
        by[nick]=p
    names=set(online)
    for nick in (s.get("members") or {}):
        names.add(norm_nick(nick))
    for nick in (s.get("mods") or []):
        names.add(norm_nick(nick))
    out=[]
    for nick in names:
        nick=norm_nick(nick)
        if not nick: continue
        p=by.get(nick) or {}
        out.append({
            "nick": nick,
            "online": nick in online,
            "channel": p.get("channel") or "",
            "title": p.get("title") or "",
            "kind": p.get("kind") or "",
            "role": server_member_role(s, nick) or ("guest" if nick in online else "member"),
        })
    out.sort(key=lambda x: (0 if x.get("online") else 1, (x.get("nick") or "").lower()))
    return out
def server_public_view(s, nick=None, include_invite=False, include_presence=False):
    nick=norm_nick(nick)
    role=server_member_role(s, nick) if nick else None
    manage=role in ("admin","mod")
    pending=[]
    if manage:
        for u, rec in (s.get("pending") or {}).items():
            pending.append({"nick":u,"at":(rec or {}).get("at")})
        pending.sort(key=lambda x: x.get("nick") or "")
    cats=s.get("categories") or [dict(c) for c in DEFAULT_SERVER_CATS]
    chans=[]
    for c in s.get("channels") or []:
        key=channel_preset_key(c, s.get("id"))
        item={"id":c.get("id"),"key":key,"title":c.get("title") or c.get("id"),"kind":c.get("kind") or "voice",
              "category":c.get("category") or "voz","public":c.get("public", True),
              "afk": bool(c.get("afk") or key=="ausentes"),
              "locked": channel_is_locked(c, s.get("id"))}
        if item["kind"]=="voice":
            item["group"]=c.get("group")
        chans.append(item)
    members=s.get("members") or {}
    member_n=len({norm_nick(n) for n in members})
    out={
        "id": s.get("id"),
        "title": s.get("title") or s.get("id"),
        "official": bool(s.get("official")),
        "owner": s.get("owner") or "",
        "categories": cats,
        "channels": chans,
        "member_count": member_n,
        "my_role": role,
        "mods": [norm_nick(x) for x in (s.get("mods") or [])] if manage else [],
        "pending": pending,
    }
    if include_invite and manage:
        out["invite"]=s.get("invite") or ""
    if manage:
        out["members"]=server_member_list(s)
    if include_presence:
        people=server_presence_people(s)
        for p in people:
            p["role"]=server_member_role(s, p.get("nick")) or "guest"
        out["people"]=people
        out["roster"]=server_roster(s, people)
    if nick:
        reloc=(s.get("reloc") or {}).get(nick)
        if reloc: out["my_reloc"]=reloc
        kick=(s.get("kicks") or {}).get(nick)
        if kick: out["my_kick"]=kick
    return out
def server_text_heads(s):
    out={}
    text=s.get("text") or {}
    sid=s.get("id")
    for ch in s.get("channels") or []:
        if (ch.get("kind") or "voice")!="text": continue
        cid=(ch.get("id") or "").strip()
        if not cid: continue
        msgs=text.get(cid) or text.get(channel_key(cid, sid)) or []
        last=msgs[-1] if msgs else {}
        out[cid]={"n":len(msgs),"at":(last or {}).get("at") or ""}
    return out
def servers_http_get(handler, path, q):
    if path=="/servers":
        doc=ensure_servers()
        nick=norm_nick((q.get("user") or [""])[0])
        out=[]
        for s in (doc.get("servers") or {}).values():
            view=server_public_view(s, nick)
            if not nick or not view.get("my_role"):
                continue
            out.append({"id":view["id"],"title":view["title"],"official":view["official"],
                        "member_count":view["member_count"],"my_role":view["my_role"],
                        "text_heads":server_text_heads(s)})
        out.sort(key=lambda r: (0 if r.get("official") else 1, (r.get("title") or "").lower()))
        handler.send_json(200, {"servers": out}); return True
    if path=="/server":
        sid=((q.get("id") or q.get("server") or [""])[0] or "").strip().lower()
        s=get_server(sid)
        if not s:
            handler.send_json(404, {"error":"servidor nao existe"}); return True
        nick=norm_nick((q.get("user") or [""])[0])
        if not nick:
            handler.send_json(401, {"error":"informe o usuario"}); return True
        view=server_public_view(s, nick, include_invite=False, include_presence=True)
        if not view.get("my_role"):
            handler.send_json(403, {"error":"sem acesso a este servidor"}); return True
        handler.send_json(200, view); return True
    if path=="/server-text":
        sid=((q.get("server") or q.get("id") or [""])[0] or "").strip().lower()
        cid=((q.get("channel") or [""])[0] or "").strip().lower()
        s=get_server(sid)
        ch=find_channel(s, cid) if s else None
        if not s or not ch or ch.get("kind")!="text":
            handler.send_json(404, {"error":"canal nao existe"}); return True
        nick=norm_nick((q.get("user") or [""])[0])
        if not server_can_enter(s, nick, ch):
            handler.send_json(403, {"error":"sem acesso a este canal"}); return True
        msgs=(s.get("text") or {}).get(cid) or []
        handler.send_json(200, {"messages": msgs[-80:]}); return True
    if path=="/server-invite":
        code=((q.get("code") or q.get("invite") or [""])[0] or "").strip()
        s=find_server_by_invite(code)
        if not s:
            handler.send_json(404, {"error":"convite invalido"}); return True
        handler.send_json(200, {"id":s.get("id"),"title":s.get("title") or s.get("id"),"official":bool(s.get("official"))}); return True
    if path=="/server-file":
        return servers_http_file_get(handler, q)
    return False
def servers_http_post(handler, path, body):
    if path not in ("/server-create","/server-channel","/server-join","/server-approve","/server-deny",
                    "/server-mod","/server-here","/server-text","/server-invite-rotate","/server-delete","/server-view",
                    "/account-login","/server-guest","/server-move","/server-moved",
                    "/server-channel-rename","/server-channel-delete","/server-channel-reorder",
                    "/server-member-add","/server-member-remove","/server-addable","/user-servers","/server-kicked"):
        return False
    user=norm_nick(body.get("user") or "")
    pw=body.get("password") if "password" in body else (body.get("pass") or "")
    if pw is None: pw=""
    if path=="/server-join":
        if not ok_nick(user) or not pw:
            handler.send_json(400, {"error":"usuario e senha obrigatorios"}); return True
        if not server_cred_ok(user, pw):
            handler.send_json(401, {"error":"nao autorizado"}); return True
        code=(body.get("invite") or body.get("code") or "").strip()
        s=find_server_by_invite(code)
        if not s:
            handler.send_json(404, {"error":"convite invalido"}); return True
        sid=s.get("id")
        role=server_member_role(s, user)
        if role in ("admin","mod","member"):
            handler.send_json(200, {"ok":True,"id":sid,"status":"member","role":role}); return True
        def _join(doc):
            srv=(doc.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            if server_member_role(srv, user) in ("admin","mod","member"):
                return {"ok":True,"id":sid,"status":"member","role":server_member_role(srv, user)}
            (srv.get("pending") or {}).pop(user, None)
            members=srv.setdefault("members", {})
            members[user]={"role":"member","joined":now()}
            return {"ok":True,"id":sid,"status":"member","role":"member"}
        out=mutate_servers(_join)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if path=="/server-guest":
        pw2=body.get("password2") if "password2" in body else (body.get("pass2") or "")
        if pw2 is None: pw2=""
        if not ok_nick(user):
            handler.send_json(400, {"error":"nick invalido"}); return True
        if len(pw)<8:
            handler.send_json(400, {"error":"senha minimo 8"}); return True
        if pw!=pw2:
            handler.send_json(400, {"error":"as senhas nao conferem"}); return True
        if account_get(user) and account_has_password(user):
            handler.send_json(409, {"error":"esse nick ja tem conta"}); return True
        code=(body.get("invite") or body.get("code") or "").strip()
        s=find_server_by_invite(code)
        if not s:
            handler.send_json(404, {"error":"convite invalido"}); return True
        sid=s.get("id")
        account_ensure(user)
        account_set_password(user, pw, role="present")
        def _guest(doc):
            srv=(doc.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            (srv.get("pending") or {}).pop(user, None)
            members=srv.setdefault("members", {})
            members[user]={"role":"member","joined":now()}
            return {"ok":True,"id":sid,"status":"member","role":"member","title":srv.get("title") or sid}
        out=mutate_servers(_guest)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if path=="/account-login":
        if not ok_nick(user) or not pw or not server_cred_ok(user, pw):
            handler.send_json(401, {"error":"usuario ou senha invalidos"}); return True
        doc=ensure_servers()
        mine=[]
        home=None
        for s in (doc.get("servers") or {}).values():
            role=server_member_role(s, user)
            if not role: continue
            item={"id":s.get("id"),"title":s.get("title") or s.get("id"),"official":bool(s.get("official")),"role":role}
            mine.append(item)
            if s.get("official"): home=item
        if not home and mine: home=mine[0]
        mine.sort(key=lambda r: (0 if r.get("official") else 1, (r.get("title") or "").lower()))
        dest=(home or {}).get("id") or ""
        scope=panel_scope_for(user, pw)
        rec=account_get(user) or {}
        handler.send_json(200, {"ok":True,"user":user,"servers":mine,"home":dest,"channel":"geral","panel_scope":scope,"must_change":bool(rec.get("must_change")),"first_setup_admin":bool(rec.get("must_change")) and needs_admin_first_setup(user, pw)}); return True
    if path=="/server-here":
        if not ok_nick(user) or not server_cred_ok(user, pw):
            handler.send_json(401, {"error":"nao autorizado"}); return True
        sid=(body.get("server") or body.get("id") or "").strip().lower()
        cid=(body.get("channel") or "").strip().lower()
        s=get_server(sid)
        ch=find_channel(s, cid) if s else None
        if not s or not ch:
            handler.send_json(404, {"error":"canal nao existe"}); return True
        if not server_can_enter(s, user, ch):
            handler.send_json(403, {"error":"sem acesso a este canal"}); return True
        leave=bool(body.get("leave"))
        def _here(doc):
            srv=(doc.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            here=srv.setdefault("here", {})
            if leave:
                here.pop(user, None)
            else:
                here[user]={"channel":cid,"at":now(),"kind":ch.get("kind")}
            return {"ok":True}
        out=mutate_servers(_here)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if path=="/server-text":
        if not ok_nick(user) or not server_cred_ok(user, pw):
            handler.send_json(401, {"error":"nao autorizado"}); return True
        sid=(body.get("server") or body.get("id") or "").strip().lower()
        cid=(body.get("channel") or "").strip().lower()
        text=(body.get("text") or "").strip()[:2000]
        s=get_server(sid)
        ch=find_channel(s, cid) if s else None
        if not s or not ch or ch.get("kind")!="text":
            handler.send_json(404, {"error":"canal de texto nao existe"}); return True
        if not server_can_enter(s, user, ch):
            handler.send_json(403, {"error":"sem acesso a este canal"}); return True
        role=server_member_role(s, user)
        if role=="guest":
            handler.send_json(403, {"error":"ouvinte nao envia texto no servidor"}); return True
        if not text:
            handler.send_json(400, {"error":"mensagem vazia"}); return True
        def _txt(doc):
            srv=(doc.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            bag=srv.setdefault("text", {})
            msgs=bag.setdefault(cid, [])
            msg={"at":now(),"nick":user,"text":text}
            msgs.append(msg)
            if len(msgs)>SERVER_TEXT_KEEP:
                del msgs[:-SERVER_TEXT_KEEP]
            here=srv.setdefault("here", {})
            here[user]={"channel":cid,"at":now(),"kind":"text"}
            return {"ok":True,"message":msg}
        out=mutate_servers(_txt)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if not ok_nick(user) or not server_cred_ok(user, pw):
        handler.send_json(401, {"error":"nao autorizado"}); return True
    if path=="/server-view":
        sid=(body.get("server") or body.get("id") or "").strip().lower()
        s=get_server(sid)
        if not s:
            handler.send_json(404, {"error":"servidor nao existe"}); return True
        if not server_member_role(s, user):
            handler.send_json(403, {"error":"sem acesso a este servidor"}); return True
        manage=server_can_manage(s, user)
        handler.send_json(200, server_public_view(s, user, include_invite=manage, include_presence=True)); return True
    if path=="/user-servers":
        if not is_global_admin_nick(user):
            handler.send_json(403, {"error":"so admin gerencia servidores pelo usuario"}); return True
        target=norm_nick(body.get("nick") or body.get("target") or "")
        if not ok_nick(target):
            handler.send_json(400, {"error":"nick invalido"}); return True
        doc=ensure_servers()
        out=[]
        for srv in (doc.get("servers") or {}).values():
            role=server_member_role(srv, target)
            out.append({
                "id":srv.get("id"),
                "title":srv.get("title") or srv.get("id"),
                "official":bool(srv.get("official")),
                "has":bool(role),
                "role":role or "",
            })
        out.sort(key=lambda r: (0 if r.get("official") else 1, (r.get("title") or "").lower()))
        handler.send_json(200, {"ok":True,"nick":target,"servers":out}); return True
    if path=="/server-create":
        if not is_global_admin_nick(user):
            handler.send_json(403, {"error":"so admin cria servidor"}); return True
        title=(body.get("title") or "").strip() or "Servidor"
        doc=ensure_servers()
        used=set((doc.get("servers") or {}).keys())
        sid=(body.get("id") or "").strip().lower()
        if sid:
            if not slug_ok(sid) or sid in used:
                handler.send_json(409, {"error":"id de servidor invalido ou em uso"}); return True
        else:
            sid=unique_slug(title, used, "servidor")
        def _create(d):
            ss=d.setdefault("servers", {})
            if sid in ss: return {"_http":(409,{"error":"esse servidor ja existe"})}
            ss[sid]={
                "id":sid,"title":title,"official":False,"owner":user,
                "invite":server_invite_code(),"created":now(),
                "categories":[dict(c) for c in DEFAULT_SERVER_CATS],
                "channels":[],
                "members":{user:{"role":"admin","joined":now()}},
                "mods":[],"pending":{},"here":{},"text":{},"reloc":{},"files":{},
            }
            v1=random_room_slug(15)
            put_open_voice_group(v1, "Voz 1")
            add_preset_channels(ss[sid], v1, create=True)
            return {"ok":True,"id":sid,"invite":ss[sid]["invite"]}
        out=mutate_servers(_create)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    sid=(body.get("server") or body.get("id") or "").strip().lower()
    s=get_server(sid)
    if not s:
        handler.send_json(404, {"error":"servidor nao existe"}); return True
    if path=="/server-move":
        if not server_can_manage(s, user):
            handler.send_json(403, {"error":"so moderador ou admin move gente"}); return True
        nick=norm_nick(body.get("nick") or body.get("target") or "")
        cid=(body.get("channel") or "").strip().lower()
        ch=find_channel(s, cid)
        if not ok_nick(nick) or not ch or ch.get("kind")!="voice":
            handler.send_json(400, {"error":"canal de voz invalido"}); return True
        def _mv(d):
            srv=(d.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            srv.setdefault("reloc", {})[nick]={
                "channel":cid,"group":ch.get("group"),"at":now(),"by":user,
                    "afk": bool(ch.get("afk") or channel_key(cid, sid)=="ausentes"),
            }
            return {"ok":True,"nick":nick,"channel":cid,"group":ch.get("group"),
                    "afk": bool(ch.get("afk") or channel_key(cid, sid)=="ausentes")}
        out=mutate_servers(_mv)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if path=="/server-moved":
        cid=(body.get("channel") or "").strip().lower()
        def _ack(d):
            srv=(d.get("servers") or {}).get(sid)
            if not srv: return {"ok":True}
            rec=(srv.get("reloc") or {}).get(user)
            if rec and (not cid or rec.get("channel")==cid):
                (srv.get("reloc") or {}).pop(user, None)
            return {"ok":True}
        handler.send_json(200, mutate_servers(_ack)); return True
    if path=="/server-delete":
        if s.get("official"):
            handler.send_json(403, {"error":"servidor oficial nao apaga"}); return True
        if not is_global_admin_nick(user) and norm_nick(s.get("owner") or "")!=user:
            handler.send_json(403, {"error":"sem permissao"}); return True
        def _del(d):
            (d.get("servers") or {}).pop(sid, None)
            return {"ok":True}
        handler.send_json(200, mutate_servers(_del)); return True
    if path=="/server-invite-rotate":
        if not server_can_manage(s, user):
            handler.send_json(403, {"error":"so moderador ou admin"}); return True
        def _rot(d):
            srv=(d.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            srv["invite"]=server_invite_code()
            return {"ok":True,"invite":srv["invite"]}
        out=mutate_servers(_rot)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if path=="/server-approve":
        if not server_can_manage(s, user):
            handler.send_json(403, {"error":"so moderador ou admin"}); return True
        nick=norm_nick(body.get("nick") or body.get("target") or "")
        if not ok_nick(nick):
            handler.send_json(400, {"error":"nick invalido"}); return True
        want=(body.get("role") or "member").strip().lower()
        if want not in ("member","mod","guest"): want="member"
        if want=="mod" and server_member_role(s, user)!="admin":
            handler.send_json(403, {"error":"so admin promove moderador"}); return True
        def _ap(d):
            srv=(d.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            pend=srv.setdefault("pending", {})
            if nick not in pend and nick not in (srv.get("members") or {}):
                return {"_http":(404,{"error":"sem pedido pendente"})}
            pend.pop(nick, None)
            members=srv.setdefault("members", {})
            members[nick]={"role":want,"joined":now()}
            mods=srv.setdefault("mods", [])
            nn=norm_nick(nick)
            if want=="mod":
                if nn not in [norm_nick(x) for x in mods]: mods.append(nick)
            else:
                srv["mods"]=[x for x in mods if norm_nick(x)!=nn]
            return {"ok":True,"nick":nick,"role":want,"galene_perm":"present"}
        out=mutate_servers(_ap)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if path=="/server-deny":
        if not server_can_manage(s, user):
            handler.send_json(403, {"error":"so moderador ou admin"}); return True
        nick=norm_nick(body.get("nick") or body.get("target") or "")
        def _dn(d):
            srv=(d.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            (srv.get("pending") or {}).pop(nick, None)
            return {"ok":True}
        handler.send_json(200, mutate_servers(_dn)); return True
    if path=="/server-kicked":
        def _kickack(d):
            srv=(d.get("servers") or {}).get(sid)
            if not srv: return {"ok":True}
            (srv.get("kicks") or {}).pop(user, None)
            return {"ok":True}
        handler.send_json(200, mutate_servers(_kickack)); return True
    if path=="/server-addable":
        if not server_can_manage(s, user):
            handler.send_json(403, {"error":"so moderador ou admin"}); return True
        handler.send_json(200, {"users": registered_nicks_without_access(s)}); return True
    if path=="/server-member-add":
        if not server_can_manage(s, user):
            handler.send_json(403, {"error":"so moderador ou admin"}); return True
        nick=norm_nick(body.get("nick") or body.get("target") or "")
        if not ok_nick(nick):
            handler.send_json(400, {"error":"nick invalido"}); return True
        if nick not in list_registered_nicks():
            handler.send_json(404, {"error":"usuario nao cadastrado"}); return True
        def _madd(d):
            srv=(d.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            if server_member_role(srv, nick):
                return {"ok":True,"nick":nick,"role":server_member_role(srv, nick),"status":"member"}
            server_add_member_nick(srv, nick)
            return {"ok":True,"nick":nick,"role":"member","status":"member","members":server_member_list(srv)}
        out=mutate_servers(_madd)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if path=="/server-member-remove":
        if not server_can_manage(s, user):
            handler.send_json(403, {"error":"so moderador ou admin"}); return True
        nick=norm_nick(body.get("nick") or body.get("target") or "")
        if not ok_nick(nick):
            handler.send_json(400, {"error":"nick invalido"}); return True
        if not server_can_edit_membership(s, user, nick):
            handler.send_json(403, {"error":"nao remove este usuario"}); return True
        def _mrm(d):
            srv=(d.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            if not server_can_edit_membership(srv, user, nick):
                return {"_http":(403,{"error":"nao remove este usuario"})}
            server_kick_nick(srv, nick, user)
            return {"ok":True,"nick":nick,"kicked":True,"members":server_member_list(srv)}
        out=mutate_servers(_mrm)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if path=="/server-mod":
        if not is_global_admin_nick(user):
            handler.send_json(403, {"error":"so admin define moderador"}); return True
        nick=norm_nick(body.get("nick") or body.get("target") or "")
        if not ok_nick(nick):
            handler.send_json(400, {"error":"nick invalido"}); return True
        if not server_member_role(s, nick):
            handler.send_json(400, {"error":"esse nick nao tem acesso a este servidor"}); return True
        on=body.get("on")
        if on is None: on=True
        def _mod(d):
            srv=(d.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            if nick==norm_nick(srv.get("owner") or ""):
                return {"_http":(400,{"error":"dono ja e admin deste servidor"})}
            members=srv.setdefault("members", {})
            rec=members.setdefault(nick, {"role":"member","joined":now()})
            mods=srv.setdefault("mods", [])
            nn=nick
            if on:
                rec["role"]="mod"
                if nn not in [norm_nick(x) for x in mods]: mods.append(nick)
            else:
                rec["role"]="member"
                srv["mods"]=[x for x in mods if norm_nick(x)!=nn]
            return {"ok":True,"nick":nick,"role":rec["role"],"galene_perm":"present"}
        out=mutate_servers(_mod)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if path=="/server-channel":
        if not server_can_manage(s, user):
            handler.send_json(403, {"error":"so moderador ou admin cria canal"}); return True
        title=(body.get("title") or "").strip()
        kind=(body.get("kind") or "voice").strip().lower()
        if kind not in ("voice","text"): kind="voice"
        cat=(body.get("category") or ("texto" if kind=="text" else "voz")).strip().lower()
        cat_ids={c.get("id") for c in (s.get("categories") or DEFAULT_SERVER_CATS)}
        if cat not in cat_ids: cat="voz" if kind=="voice" else "texto"
        if not title:
            handler.send_json(400, {"error":"titulo obrigatorio"}); return True
        if kind=="voice":
            nvoice=sum(1 for c in (s.get("channels") or []) if c.get("kind")=="voice")
            if nvoice>=SERVER_VOICE_LIMIT:
                handler.send_json(400, {"error":"limite de canais de voz neste servidor"}); return True
        used=set()
        for c in (s.get("channels") or []):
            used.add(c.get("id") or "")
            used.add(c.get("key") or "")
            used.add(channel_key(c.get("id"), sid))
        key=unique_slug(title, used, "canal")
        cid=channel_uid(sid, key)
        group=None
        if kind=="voice":
            group=random_room_slug(15)
            ok_g, err=put_open_voice_group(group, title)
            if not ok_g:
                handler.send_json(500, {"error":err or "nao criou o grupo galene"}); return True
        def _ch(d):
            srv=(d.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            ch={"id":cid,"key":key,"title":title,"kind":kind,"category":cat,"public":True}
            if group: ch["group"]=group
            srv.setdefault("channels", []).append(ch)
            srv["channels"]=channels_text_then_voice(srv.get("channels"))
            return {"ok":True,"channel":ch}
        out=mutate_servers(_ch)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if path=="/server-channel-rename":
        if not server_can_manage(s, user):
            handler.send_json(403, {"error":"so moderador ou admin"}); return True
        cid=(body.get("channel") or body.get("id") or "").strip().lower()
        title=(body.get("title") or "").strip()
        ch=find_channel(s, cid)
        if not ch:
            handler.send_json(404, {"error":"canal nao existe"}); return True
        if not title:
            handler.send_json(400, {"error":"titulo obrigatorio"}); return True
        def _ren(d):
            srv=(d.get("servers") or {}).get(sid)
            rec=find_channel(srv, cid)
            if not srv or not rec: return {"_http":(404,{"error":"canal nao existe"})}
            rec["title"]=title
            return {"ok":True,"channel":rec}
        out=mutate_servers(_ren)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if path=="/server-channel-reorder":
        if not server_can_manage(s, user):
            handler.send_json(403, {"error":"so moderador ou admin"}); return True
        order=body.get("order") or body.get("channels") or []
        if not isinstance(order, list) or not order:
            handler.send_json(400, {"error":"informe a nova ordem"}); return True
        def _ord(d):
            srv=(d.get("servers") or {}).get(sid)
            if not srv: return {"_http":(404,{"error":"servidor nao existe"})}
            chans=list(srv.get("channels") or [])
            seen=set(); new=[]
            for raw in order:
                cid=str(raw or "").strip().lower()
                rec=find_channel(srv, cid)
                rid=(rec or {}).get("id")
                if rec and rid and rid not in seen:
                    new.append(rec); seen.add(rid)
            for c in chans:
                rid=c.get("id")
                if rid and rid not in seen:
                    new.append(c); seen.add(rid)
            srv["channels"]=channels_text_then_voice(new)
            return {"ok":True}
        out=mutate_servers(_ord)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        handler.send_json(200, out); return True
    if path=="/server-channel-delete":
        if not server_can_manage(s, user):
            handler.send_json(403, {"error":"so moderador ou admin"}); return True
        cid=(body.get("channel") or body.get("id") or "").strip().lower()
        ch=find_channel(s, cid)
        if not ch:
            handler.send_json(404, {"error":"canal nao existe"}); return True
        if channel_is_locked(ch, sid):
            handler.send_json(403, {"error":"esta sala do preset nao apaga"}); return True
        if ch.get("kind")=="text":
            ntext=sum(1 for c in (s.get("channels") or []) if c.get("kind")=="text")
            if ntext<=1:
                handler.send_json(400, {"error":"precisa ficar pelo menos um canal de texto"}); return True
        if ch.get("kind")=="voice" and ch.get("group")==main_id():
            handler.send_json(403, {"error":"canal principal de voz nao apaga"}); return True
        drop_gid=ch.get("group") if ch.get("kind")=="voice" else None
        real_id=ch.get("id")
        def _rm(d):
            srv=(d.get("servers") or {}).get(sid)
            rec=find_channel(srv, cid)
            if not srv or not rec: return {"_http":(404,{"error":"canal nao existe"})}
            rid=rec.get("id")
            srv["channels"]=[c for c in (srv.get("channels") or []) if c.get("id")!=rid]
            (srv.get("text") or {}).pop(rid, None)
            here=srv.get("here") or {}
            for nick, rec_h in list(here.items()):
                if isinstance(rec_h, dict) and rec_h.get("channel")==rid:
                    here.pop(nick, None)
            return {"ok":True,"id":rid}
        out=mutate_servers(_rm)
        if isinstance(out, dict) and out.get("_http"):
            code,payload=out["_http"]; handler.send_json(code, payload); return True
        if drop_gid and drop_gid!=main_id():
            still=False
            with _SERVER_LOCK:
                doc=load_servers_unlocked()
                for srv in (doc.get("servers") or {}).values():
                    for c in srv.get("channels") or []:
                        if c.get("group")==drop_gid:
                            still=True
                            break
                    if still: break
            if not still:
                ia=internal_auth()
                if ia:
                    galene("DELETE", f"/galene-api/v0/.groups/{quote(drop_gid, safe='')}", ia)
                fp=GROUPS/f"{drop_gid}.json"
                try:
                    if fp.exists(): fp.unlink()
                except Exception:
                    pass
        handler.send_json(200, out); return True
    handler.send_json(404, {"error":"not found"}); return True
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
def presence_auth_ok(gid, user, password):
    """Beacon/presença/net-event: nick + senha da sala (ou conta). Sala aberta só exige nick."""
    if not ok_nick(user):
        return False
    if is_open(gid):
        return True
    pw = password if password is not None else ""
    if not pw:
        return False
    if account_verify_password(user, pw):
        return True
    real, rec = find_group_user(gid, user)
    if real and password_match((rec or {}).get("password"), pw):
        return True
    g = load_group(gid)
    if not g:
        g = {}
        fp = GROUPS/f"{gid}.json"
        if fp.exists():
            try: g=json.loads(fp.read_text(encoding="utf-8"))
            except Exception: g={}
    wp=(g.get("wildcard-user") or {}).get("password")
    return password_match(wp, pw)
def galene_collection_path(path):
    """Listas da API Galene (.users / .groups / .tokens) só existem com barra final.
    Sem a barra o servidor devolve o texto cru '404 page not found' — e o painel
    mostra isso embaixo do botão Entrar depois do panel-login já ter passado."""
    if not path: return path
    base, _, qs = path.partition("?")
    if base.endswith("/.password"):
        return path
    for suf in ("/.users", "/.groups", "/.tokens"):
        if base.endswith(suf):
            return base+"/"+(("?"+qs) if qs else "")
    return path
def galene(method, path, auth, body=None, ctype="application/json", extra_headers=None):
    path=galene_collection_path(path)
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
def strip_server_voice_ttl():
    """Canal de voz de servidor não é sala extra de 24h — tira prazo colado por engano."""
    ids=server_voice_group_ids()
    d=load(); changed=False
    for gid, b in list(d.items()):
        if not isinstance(b, dict): continue
        if gid not in ids: continue
        if b.get("ttl"):
            b.pop("ttl", None)
            changed=True
    if changed: save(d)
def ensure_public_ttl():
    """Salas públicas extra (não a main, não canal de voz) passam a ter 24h se ainda não tiverem prazo."""
    strip_server_voice_ttl()
    ids=server_voice_group_ids()
    d=load(); main=main_id(); nowdt=datetime.now(TZ); changed=False
    for fp in GROUPS.glob("*.json"):
        gid=fp.stem
        if gid==main or not is_open(gid): continue
        if gid in ids: continue
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
    ids=server_voice_group_ids()
    d=load(); main=main_id(); nowdt=datetime.now(TZ)
    for gid in list(d.keys()):
        if gid==main: continue
        if gid in ids:
            if isinstance(d.get(gid), dict) and d[gid].get("ttl"):
                d[gid].pop("ttl", None); save(d)
            continue
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
        try: prune_stale_guests()
        except Exception: pass
        try: presence_tick_all()
        except Exception: pass

def presence_tick_all():
    tnow = datetime.now(TZ)
    with _SAVE_LOCK:
        d = load_unlocked()
        dirty = False
        for gid, b in list(d.items()):
            if not isinstance(b, dict):
                continue
            before = json.dumps(b.get("live") or {}, sort_keys=True, default=str)
            presence_prune_room(b, tnow, gid=gid)
            after = json.dumps(b.get("live") or {}, sort_keys=True, default=str)
            if before != after:
                dirty = True
        if dirty:
            save_unlocked(d)
def panel_login_ok(user, password):
    """Só admin de verdade: sidecar.auth, config.json, cofre (op) ou op legado da main. Anfitrião 24h não entra."""
    user=norm_nick(user)
    if not user or password is None: return False
    su,spw=sidecar_plain()
    if su is not None and user==su and password==spw: return True
    if config_admin_ok(user, password): return True
    if account_get_role(user) in ("op","admin") and account_verify_password(user, password):
        return True
    main=main_id()
    real, rec=find_group_user(main, user)
    if not real: return False
    perm=user_perm_name_from(rec)
    if perm not in ("op","admin"): return False
    if password_match(rec.get("password"), password): return True
    if galene_user_auth_ok(main, real, password): return True
    return False
def needs_admin_first_setup(user, password):
    """Modal de duas senhas só para o admin de fábrica (id 0 / sidecar), não para outro op criado no painel."""
    user=norm_nick(user)
    if not panel_login_ok(user, password):
        return False
    d=load_accounts()
    uid=d["by_nick"].get(user)
    try:
        if uid is not None and int(uid)==0:
            return True
    except Exception:
        pass
    su,_=sidecar_plain()
    return su is not None and user==su
def hash_plain(pw):
    salt=os.urandom(8)
    key=hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, 4096, dklen=32)
    return {"type":"pbkdf2","hash":"sha-256","key":key.hex(),"salt":salt.hex(),"iterations":4096}
def account_get(nick):
    nick=norm_nick(nick)
    if not nick: return None
    d=load_accounts()
    uid=d["by_nick"].get(nick)
    if uid is None: return None
    rec=d["by_id"].get(str(uid))
    if not rec or not rec.get("active", True): return None
    rn=rec.get("nick")
    if rn and norm_nick(rn)!=nick: return None
    return rec
def account_has_password(nick):
    rec=account_get(nick)
    return bool(rec and rec.get("password"))
def account_get_role(nick):
    rec=account_get(nick)
    if not rec: return "present"
    role=rec.get("role") or rec.get("permissions") or "present"
    if role=="ouvinte": return "ouvinte"
    if role in ("op","admin"): return role
    return "present"
def role_to_galene_body(role):
    if role in ("op","admin"): return json.dumps({"permissions":"op"})
    if role=="ouvinte": return json.dumps({"permissions":["present"]})
    return json.dumps({"permissions":"present"})
def account_set_password(nick, password, role=None, must_change=None):
    nick=norm_nick(nick)
    if not nick or password is None: return False
    account_ensure(nick)
    d=load_accounts()
    uid=d["by_nick"][nick]
    rec=d["by_id"][str(uid)]
    if isinstance(password, dict):
        rec["password"]=password
    else:
        rec["password"]=hash_plain(password)
        if must_change is None and password==FACTORY_PASSWORD:
            must_change=True
    if role: rec["role"]=role
    if must_change is not None:
        rec["must_change"]=bool(must_change)
    save_accounts(d)
    return True
def account_set_must_change(nick, on=True):
    nick=norm_nick(nick)
    if not nick: return
    d=load_accounts()
    uid=d["by_nick"].get(nick)
    if uid is None: return
    rec=d["by_id"].get(str(uid))
    if not rec: return
    rec["must_change"]=bool(on)
    save_accounts(d)
def account_set_role(nick, role):
    nick=norm_nick(nick)
    if not nick: return
    account_ensure(nick)
    d=load_accounts()
    uid=d["by_nick"].get(nick)
    if uid is None: return
    d["by_id"][str(uid)]["role"]=role
    save_accounts(d)
def account_verify_password(nick, password):
    nick=norm_nick(nick)
    if not nick or password is None: return False
    rec=account_get(nick)
    if rec:
        pw=rec.get("password")
        if pw and password_match(pw, password): return True
    main=main_id()
    real, mrec=find_group_user(main, nick)
    if real:
        if password_match(mrec.get("password"), password):
            if rec and not rec.get("password"):
                pwobj=mrec.get("password")
                if isinstance(pwobj, dict):
                    account_set_password(nick, pwobj)
                else:
                    account_set_password(nick, password)
                if not rec.get("role"):
                    account_set_role(nick, user_perm_name_from(mrec) or "present")
            return True
        if galene_user_auth_ok(main, real, password): return True
    if rec:
        for fp in GROUPS.glob("*.json"):
            real2, mrec2=find_group_user(fp.stem, nick)
            if real2 and password_match(mrec2.get("password"), password):
                pwobj=mrec2.get("password")
                if isinstance(pwobj, dict):
                    account_set_password(nick, pwobj)
                else:
                    account_set_password(nick, password)
                return True
    return False
def is_vault_account(nick):
    return account_get(nick) is not None and account_has_password(nick)
def is_named_user(gid, nick):
    nick=norm_nick(nick)
    if nick in named(gid): return True
    return is_vault_account(nick)
def galene_sync_account(gid, nick, password=None, auth=None):
    nick=norm_nick(nick)
    if not account_get(nick): return False
    ia=auth or internal_auth()
    if not ia: return False
    role=account_get_role(nick)
    qg,qu=quote(gid,safe=""), quote(nick,safe="")
    galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}", ia, role_to_galene_body(role))
    if password:
        galene("POST", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", ia, password, "text/plain")
    harden_group(gid)
    return True
def accounts_public_view(d):
    out={"next_id":d.get("next_id"),"by_id":{},"by_nick":dict(d.get("by_nick") or {})}
    for k,v in (d.get("by_id") or {}).items():
        rec=dict(v)
        rec.pop("password", None)
        out["by_id"][k]=rec
    return out
def account_migrate_from_groups():
    """Copia hash de senha e cargo da sala principal para o cofre (migração única)."""
    main=main_id()
    g=load_group(main)
    if not g: return
    for nick_raw, rec in (g.get("users") or {}).items():
        nick=norm_nick(nick_raw)
        if not nick: continue
        account_ensure(nick, force_id=0 if nick=="admin" else None)
        d=load_accounts()
        uid=d["by_nick"][nick]
        acct=d["by_id"][str(uid)]
        changed=False
        if not acct.get("password"):
            pw=rec.get("password")
            if isinstance(pw, dict) and pw.get("type"):
                acct["password"]=pw; changed=True
            elif isinstance(pw, str) and pw:
                acct["password"]=hash_plain(pw); changed=True
        if not acct.get("role"):
            acct["role"]=user_perm_name_from(rec) or "present"; changed=True
        if changed: save_accounts(d)
GUEST_TTL_H=24
def prune_stale_guests():
    """Remove convidados sem pedido de cadastro após 24h (histórico fica em access.log)."""
    d=load()
    changed=False
    cutoff=datetime.now(TZ)-timedelta(hours=GUEST_TTL_H)
    for gid, b in list(d.items()):
        if not isinstance(b, dict): continue
        pending=b.get("pending") or {}
        guests=b.get("guests") or {}
        denied=b.get("denied") or {}
        blocked=b.get("blocked") or {}
        for user in list(guests.keys()):
            if user in pending or user in denied or user in blocked: continue
            if is_vault_account(user): continue
            rec=guests.get(user) or {}
            first=parse_iso(rec.get("first") or rec.get("last"))
            if not first: continue
            if first<=cutoff:
                guests.pop(user, None)
                access_log("convidado_expirado", gid, user, rec.get("ip") or "")
                changed=True
    if changed: save(d)
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
        rest=galene_collection_path(rest)
        parts=rest.split("/")
        try:
            if ".users" in parts:
                i=parts.index(".users")
                if i+1 < len(parts) and parts[i+1] and not parts[i+1].startswith("."):
                    parts[i+1]=norm_nick(parts[i+1])
                    rest="/".join(parts)
        except Exception: pass
        rest=galene_collection_path(rest)
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
        if method=="POST" and ".password" in rest and code < 400:
            try:
                segs=[x for x in rest.split("/") if x]
                if ".users" in segs:
                    i=segs.index(".users")
                    if i+1 < len(segs):
                        nick=norm_nick(segs[i+1])
                        plain=raw.decode("utf-8") if raw else ""
                        if nick and plain and len(plain)>=8 and not nick.startswith("."):
                            account_set_password(nick, plain)
            except Exception: pass
        if method=="PUT" and ".users" in rest and code < 400 and not rest.rstrip("/").endswith(".password"):
            try:
                segs=[x for x in rest.split("/") if x]
                if len(segs)>=4 and segs[2]==".users":
                    nick=norm_nick(segs[3])
                    if nick and raw:
                        bodyj=json.loads(raw.decode("utf-8"))
                        perm=bodyj.get("permissions")
                        if perm in ("op","admin") or (isinstance(perm, list) and ("op" in perm or "admin" in perm)):
                            account_set_role(nick, "op")
                        elif perm=="ouvinte" or (isinstance(perm, list) and perm==["present"]):
                            account_set_role(nick, "ouvinte")
                        elif perm:
                            account_set_role(nick, "present")
            except Exception: pass
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
            self.send_json(200, accounts_public_view(load_accounts())); return
        if path=="/must-change":
            self.send_json(200, {"user":"", "must_change": False}); return
        if path=="/access-log":
            ok,_=self.admin_ok()
            if not ok: self.send_json(401, {"error":"nao autorizado"}); return
            try: lim=int((q.get("limit") or ["300"])[0])
            except Exception: lim=300
            lim=max(1, min(lim, 2000))
            self.send_json(200, {"entries": read_access_log(lim)}); return
        if path=="/net-log":
            ok,_=self.admin_ok()
            if not ok: self.send_json(401, {"error":"nao autorizado"}); return
            try: lim=int((q.get("limit") or ["400"])[0])
            except Exception: lim=400
            lim=max(1, min(lim, 2000))
            self.send_json(200, {"entries": read_net_log(lim)}); return
        if path=="/rooms":
            rooms=[]
            d=load()
            main=main_id()
            all_flag=(q.get("all") or ["0"])[0] in ("1","true","yes")
            if all_flag:
                ok,_=self.admin_ok()
                if not ok:
                    self.send_json(401, {"error":"nao autorizado"}); return
            counts=galene_group_counts_cached()
            tnow=datetime.now(TZ)
            voice_ids=server_voice_group_ids()
            for fp in sorted(GROUPS.glob("*.json")):
                try: g=json.loads(fp.read_text(encoding="utf-8"))
                except Exception: continue
                stem=fp.stem
                pw=(g.get("wildcard-user") or {}).get("password")
                voice_bound=stem in voice_ids
                info=ttl_info(stem, d.get(stem) or {})
                if voice_bound:
                    info={"ttl": False, "expires_at": None, "remaining_s": None, "host": None, "kind": None}
                if (info.get("ttl") or voice_bound) and not all_flag:
                    continue
                is_main=(stem==main)
                is_open=(not pw) or (isinstance(pw, dict) and pw.get("type")=="wildcard")
                b=bucket(d, stem)
                live_s, live_active=room_live_seconds(b, tnow, gid=stem)
                if counts is None:
                    online=presence_online_count(b, tnow)
                else:
                    online=counts.get(stem, 0)
                rooms.append({"id":stem,"title":g.get("displayName") or stem,"main":is_main,
                    "public":bool(g.get("public")),
                    "open": bool(is_open) and not is_main,
                    "invite": not is_open or is_main,
                    "updated": datetime.fromtimestamp(fp.stat().st_mtime, TZ).isoformat(timespec="seconds"),
                    "ttl": bool(info.get("ttl")), "expires_at": info.get("expires_at"),
                    "remaining_s": info.get("remaining_s"), "host": info.get("host"), "kind": info.get("kind"),
                    "server_voice": bool(voice_bound),
                    "online": online, "live_s": live_s, "live_active": live_active})
            rooms.sort(key=lambda r: (0 if r.get("main") else 1, (r.get("title") or r.get("id") or "").lower()))
            self.send_json(200, rooms); return
        if path=="/temp-status":
            g=(q.get("group") or ["spartan"])[0]; user=norm_nick((q.get("user") or [""])[0])
            d=load(); b=bucket(d,g); info=ttl_info(g, b)
            out={"open":is_open(g),"purge":int(b.get("purge") or 0),"banned":ip_banned(b,self.cip()),
                "taken": is_named_user(g, user) or user in (b.get("pending") or {}) or user in (b.get("denied") or {}) or user in (b.get("blocked") or {})}
            out.update(info)
            self.send_json(200, out)
            return
        if path=="/status":
            g=(q.get("group") or ["spartan"])[0]; user=norm_nick((q.get("user") or [""])[0]); b=bucket(load(), g)
            st="denied" if user in b["denied"] else "blocked" if user in b["blocked"] else "pending" if user in b["pending"] else "named" if is_named_user(g, user) else ("temp" if is_open(g) else "guest")
            self.send_json(200, {"status":st, "created": (b.get("created") or {}).get(user)}); return
        if path=="/presence-user":
            g=(q.get("group") or ["spartan"])[0]
            user=norm_nick((q.get("user") or [""])[0])
            if not ok_nick(user):
                self.send_json(400, {"error":"nick invalido"}); return
            b=bucket(load(), g)
            self.send_json(200, presence_user_state(b, user)); return
        if path=="/presence-room":
            g=(q.get("group") or ["spartan"])[0]
            user=norm_nick((q.get("user") or [""])[0])
            d=load(); b=bucket(d, g); tnow=datetime.now(TZ)
            room_ls, room_active=room_live_seconds(b, tnow, gid=g)
            out={"room_live_s": room_ls, "room_active": room_active,
                 "online": presence_online_count(b, tnow)}
            if user and ok_nick(user):
                ul, ua, uo=user_live_seconds(b, user, tnow)
                out.update({"user_live_s": ul, "user_active": ua, "user_online": uo,
                            "live_s": ul, "active": ua})
            self.send_json(200, out); return
        if servers_http_get(self, path, q): return
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
        if path=="/server-file":
            servers_http_file_post(self); return
        body=self.read_json()
        g=(body.get("group") or "spartan").strip() or "spartan"; user=norm_nick(body.get("user") or "")
        if servers_http_post(self, path, body): return
        if path=="/beacon":
            pw=body.get("password") or body.get("pass") or ""
            if not ok_nick(user): self.send_json(400, {"error":"nick invalido"}); return
            if not presence_auth_ok(g, user, pw):
                self.send_json(401, {"error":"nao autorizado"}); return
            def _beacon(d):
                b=bucket(d,g); t=now(); ip=self.cip()
                if ip_banned(b, ip):
                    return {"_http": (403, {"error":"IP suspenso nesta sala por 24h"})}
                rec=b.setdefault("seen",{}).setdefault(user, {"first":t,"last":t,"ip":ip}); rec["last"]=t; rec["ip"]=ip
                if is_named_user(g, user):
                    access_log("cadastrado", g, user, ip)
                    presence_heartbeat(b, user, gid=g)
                    return {"ok":True,"named":True}
                if is_open(g):
                    ensure_open_ouvinte(g)
                    rec=b.setdefault("temps",{}).setdefault(user, {"first":t,"last":t,"ip":ip}); rec["last"]=t; rec["ip"]=ip
                    access_log("temporario", g, user, ip)
                else:
                    rec=b["guests"].setdefault(user, {"first":t,"last":t,"ip":ip}); rec["last"]=t; rec["ip"]=ip
                    access_log("convidado", g, user, ip)
                presence_heartbeat(b, user, gid=g)
                return {"ok":True}
            out=mutate_registry(_beacon)
            if isinstance(out, dict) and out.get("_http"):
                code, payload=out["_http"]; self.send_json(code, payload); return
            self.send_json(200, out); return
        if path=="/presence":
            pw=body.get("password") or body.get("pass") or ""
            if not ok_nick(user): self.send_json(400, {"error":"nick invalido"}); return
            if not presence_auth_ok(g, user, pw):
                self.send_json(401, {"error":"nao autorizado"}); return
            def _pres(d):
                b=bucket(d,g); tnow=datetime.now(TZ)
                if body.get("leave"):
                    presence_leave(b, user, tnow, gid=g)
                else:
                    presence_heartbeat(b, user, tnow, gid=g)
                room_ls, room_active=room_live_seconds(b, tnow, gid=g)
                state=presence_user_state(b, user, tnow)
                state["room_live_s"]=room_ls
                state["room_active"]=room_active
                state["user_live_s"]=state.get("live_s", 0)
                state["user_active"]=state.get("active", False)
                return state
            self.send_json(200, mutate_registry(_pres)); return
        if path=="/must-change":
            u=norm_nick(body.get("user") or user or "")
            pw=body.get("password") if "password" in body else (body.get("pass") or "")
            if pw is None: pw=""
            must=False
            admin=False
            if ok_nick(u) and pw and account_verify_password(u, pw):
                d=load_accounts()
                uid=d["by_nick"].get(u)
                if uid is not None:
                    rec=d["by_id"].get(str(uid)) or {}
                    must=bool(rec.get("must_change"))
                admin=needs_admin_first_setup(u, pw)
            self.send_json(200, {"user":u,"must_change":must,"admin":admin}); return
        if path=="/register":
            pw=body.get("password") or ""
            if not ok_nick(user) or len(pw)<8: self.send_json(400, {"error":"nick ou senha (minimo 8)"}); return
            if is_open(g): self.send_json(403, {"error":"sala publica nao tem cadastro"}); return
            d=load(); b=bucket(d,g)
            if user in b["denied"] or user in b["blocked"]: self.send_json(403, {"error":"este nick foi bloqueado"}); return
            if is_named_user(g, user): self.send_json(409, {"error":"este nick ja tem cadastro"}); return
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
            scope=panel_scope_for(u, pw)
            if scope:
                access_log("painel_admin" if scope=="admin" else "painel_mod", "painel", u, self.cip())
                self.send_json(200, {"ok":True,"scope":scope})
            else:
                self.send_json(401, {"error":"Usuário ou senha inválidos. Use a conta admin da sala principal, não a senha de amigos nem o anfitrião temporário."})
            return
        if path=="/can-panel":
            u=norm_nick(body.get("user") or user or "")
            pw=body.get("password") if "password" in body else body.get("pass")
            if pw is None: pw=""
            scope=panel_scope_for(u, pw)
            self.send_json(200, {"ok": bool(scope), "scope": scope})
            return
        if path=="/net-event":
            nick=norm_nick(body.get("user") or user or "") or "?"
            sala=(body.get("group") or g or "").strip() or "spartan"
            pw=body.get("password") or body.get("pass") or ""
            if nick != "?" and not presence_auth_ok(sala, nick, pw):
                self.send_json(401, {"error":"nao autorizado"}); return
            ua=(body.get("ua") or self.headers.get("User-Agent") or "")[:180]
            rec={"quando":now(),"sala":sala,"nick":nick,"ip":self.cip(),
                 "phase": body.get("phase") or "drop",
                 "duration_ms": body.get("duration_ms") or 0,
                 "code": body.get("code"),
                 "reason": (body.get("reason") or "")[:240],
                 "ua": ua}
            net_log(rec)
            self.send_json(200, {"ok": True})
            return
        if path=="/join-named":
            pw=body.get("password") or ""
            gid=(body.get("group") or g).strip() or "spartan"
            if not ok_nick(user) or not pw:
                self.send_json(400, {"error":"usuario e senha obrigatorios"}); return
            if not (GROUPS/f"{gid}.json").exists():
                self.send_json(404, {"error":"sala nao existe"}); return
            main=main_id()
            mreal, mrec=find_group_user(main, user)
            if account_get(user) or mreal:
                if not account_verify_password(user, pw):
                    self.send_json(401, {"error":"senha incorreta"}); return
                if not account_has_password(user):
                    account_set_password(user, pw, role=user_perm_name_from(mrec) or "present")
                if not galene_sync_account(gid, user, password=pw):
                    self.send_json(500, {"error":"nao sincronizou a conta na sala"}); return
                self.send_json(200, {"ok":True,"role": account_get_role(user)}); return
            real, rec=find_group_user(gid, user)
            if real:
                if password_match(rec.get("password"), pw) or galene_user_auth_ok(gid, real, pw):
                    self.send_json(200, {"ok":True,"role": user_perm_name_from(rec) or "present"}); return
                self.send_json(401, {"error":"senha incorreta"}); return
            self.send_json(401, {"error":"conta nao encontrada. Use o nick da sua conta cadastrada."}); return
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
            account_set_password(u, new_admin, role="op", must_change=False)
            self.send_json(200, {"ok":True}); return
        if path=="/first-password":
            u=norm_nick(body.get("user") or "")
            old=body.get("old") or body.get("password") or ""
            new=body.get("new") or body.get("password_new") or ""
            if not ok_nick(u) or len(new)<8:
                self.send_json(400, {"error":"senha minimo 8"}); return
            if new==old or new==FACTORY_PASSWORD:
                self.send_json(400, {"error":"escolha uma senha nova (diferente de Mudar@123)"}); return
            if not account_verify_password(u, old):
                self.send_json(401, {"error":"senha atual invalida"}); return
            if needs_admin_first_setup(u, old):
                self.send_json(400, {"error":"admin usa first-setup"}); return
            d=load_accounts()
            uid=d["by_nick"].get(u)
            if uid is None:
                self.send_json(404, {"error":"conta nao encontrada"}); return
            rec=d["by_id"].get(str(uid)) or {}
            if not rec.get("must_change"):
                self.send_json(400, {"error":"ja configurado"}); return
            ia=internal_auth()
            if not ia:
                self.send_json(500, {"error":"sidecar.auth ausente"}); return
            site=load_site(); main=site.get("main") or "spartan"
            galene_sync_account(main, u, password=new, auth=ia)
            for fp in GROUPS.glob("*.json"):
                if fp.stem==main: continue
                real,_=find_group_user(fp.stem, u)
                if real:
                    galene_sync_account(fp.stem, u, password=new, auth=ia)
            account_set_password(u, new, must_change=False)
            self.send_json(200, {"ok":True}); return
        ok,auth=self.admin_ok()
        if not ok: self.send_json(401, {"error":"nao autorizado"}); return
        if path=="/create-room":
            title=(body.get("title") or "").strip()
            open_room=bool(body.get("open") or body.get("public"))
            friends=body.get("friends_password") or body.get("password") or ""
            use_ttl=bool(body.get("ttl")) or open_room
            if open_room:
                use_ttl=True
            if use_ttl:
                slug=random_room_slug(15)
                if not title:
                    title=(body.get("id") or body.get("slug") or slug).strip() or slug
            else:
                slug=(body.get("id") or body.get("slug") or "").strip().lower()
                if not slug_ok(slug):
                    self.send_json(400, {"error":"nome da sala invalido"}); return
                if slug==main_id() or (GROUPS/f"{slug}.json").exists():
                    self.send_json(409, {"error":"essa sala ja existe"}); return
                if not title:
                    title=slug
            if not open_room and len(friends)<8:
                self.send_json(400, {"error":"senha de convite minimo 8"}); return
            want_host=bool(body.get("host"))
            host_nick=norm_nick(body.get("host_nick") or body.get("host_user") or "")
            host_pw=body.get("host_password") or ""
            if want_host and not use_ttl:
                self.send_json(400, {"error":"anfitriao so em sala de 24h"}); return
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
            if want_host and use_ttl:
                qu=quote(host_nick, safe="")
                galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}", ia, json.dumps({"permissions":"op"}))
                galene("POST", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", ia, host_pw, "text/plain")
                host_saved=host_nick
            harden_group(slug)
            ttl=None
            if use_ttl:
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
        if path=="/reset-factory-password":
            nick=norm_nick(body.get("nick") or body.get("target") or "")
            if not ok_nick(nick):
                self.send_json(400, {"error":"nick invalido"}); return
            account_set_password(nick, FACTORY_PASSWORD, must_change=True)
            site=load_site(); main=site.get("main") or "spartan"
            galene_sync_account(main, nick, password=FACTORY_PASSWORD, auth=auth)
            for fp in GROUPS.glob("*.json"):
                if fp.stem==main: continue
                real,_=find_group_user(fp.stem, nick)
                if real:
                    galene_sync_account(fp.stem, nick, password=FACTORY_PASSWORD, auth=auth)
            self.send_json(200, {"ok":True}); return
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
            account_set_role(user, "present")
            b["pending"].pop(user,None); b["denied"].pop(user,None); b["blocked"].pop(user,None); b["guests"].pop(user,None)
            b.setdefault("created",{})[user]=now(); save(d)
            access_log("conta_aprovada", g, user, self.cip())
            self.send_json(200, {"ok":True}); return
        if path=="/quick":
            pw=(body.get("password") or "").strip() or FACTORY_PASSWORD
            perm=body.get("permissions") or "present"
            if len(pw)<8: self.send_json(400, {"error":"senha minimo 8"}); return
            role="op" if perm in ("op","admin") else "present"
            galene("PUT", f"/galene-api/v0/.groups/{qg}/.users/{qu}", auth, role_to_galene_body(role))
            galene("POST", f"/galene-api/v0/.groups/{qg}/.users/{qu}/.password", auth, pw, "text/plain")
            harden_group(g)
            account_set_password(user, pw, role=role, must_change=True)
            b["pending"].pop(user,None); b["denied"].pop(user,None); b["blocked"].pop(user,None); b["guests"].pop(user,None)
            b.setdefault("created",{})[user]=now(); save(d)
            access_log("conta_criada", g, user, self.cip())
            self.send_json(200, {"ok":True}); return
        if path in ("/deny","/block"):
            tt=now(); kind="named" if is_named_user(g, user) else "guest"
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
    try: account_migrate_from_groups()
    except Exception: pass
    try: ensure_public_ttl()
    except Exception: pass
    Thread(target=expire_loop, daemon=True).start()
    print("spartan-reg on", PORT, flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
