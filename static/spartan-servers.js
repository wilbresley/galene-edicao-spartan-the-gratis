'use strict';

/**
 * Casca Fluxer: servidores, canais, texto ao lado da voz (iframe não cai).
 */
(function() {
  var API = '/spartan-api';
  var listCache = [];
  var detail = null;
  var current = { server: null, channel: null, voice: null, voiceGroup: null, voiceTitle: '', voiceServer: null, voiceServerTitle: '' };
  var pollTimer = null;
  var textOpen = true;
  var lastTextCount = 0;
  var textAlerted = {};
  var mediaState = { nick: '', mic: false, share: false, cam: false };
  var switchPending = null;
  var invitePending = null;
  var talkByNick = {};
  var liveByNick = {};
  var volOpenNick = '';

  function $(id) { return document.getElementById(id); }

  function cred() {
    try {
      var g = JSON.parse(sessionStorage.getItem('spartanGlobalCred') || 'null');
      if(g && g.user) return { user: String(g.user).toLowerCase(), pass: g.pass || '' };
    } catch(e) {}
    try {
      var a = JSON.parse(sessionStorage.getItem('spartanAdmin') || 'null');
      if(a && a.user) return { user: String(a.user).toLowerCase(), pass: a.pass || '' };
    } catch(e) {}
    return { user: '', pass: '' };
  }

  function apiGet(path) {
    return fetch(API + path, { cache: 'no-store', credentials: 'omit' }).then(function(r) {
      return r.json().then(function(j) {
        if(!r.ok) {
          var err = new Error((j && j.error) || r.statusText);
          err.status = r.status;
          throw err;
        }
        return j;
      });
    });
  }

  function apiPost(path, body) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      credentials: 'omit',
    }).then(function(r) {
      return r.json().then(function(j) {
        if(!r.ok) throw new Error((j && j.error) || r.statusText);
        return j;
      });
    });
  }

  function findByGroup(gid) {
    var i, j, c;
    if(detail && detail.channels) {
      for(j = 0; j < detail.channels.length; j++) {
        c = detail.channels[j];
        if(c.kind === 'voice' && c.group === gid) return { server: detail.id, channel: c.id, ch: c };
      }
    }
    for(i = 0; i < listCache.length; i++) {
      var s = listCache[i];
      if(!s || !s._channels) continue;
      for(j = 0; j < s._channels.length; j++) {
        c = s._channels[j];
        if(c.kind === 'voice' && c.group === gid) return { server: s.id, channel: c.id, ch: c };
      }
    }
    return null;
  }

  function chanKey(c) {
    if(!c) return '';
    if(c.key) return String(c.key);
    var id = String(c.id || '');
    var i = id.lastIndexOf('__');
    return i >= 0 ? id.slice(i + 2) : id;
  }

  function channelOf(cid) {
    var list = (detail && detail.channels) || [];
    var i, c, want;
    want = String(cid || '');
    for(i = 0; i < list.length; i++) {
      c = list[i];
      if(c.id === want || c.key === want || chanKey(c) === want) return c;
    }
    return null;
  }

  function defaultChannel(d) {
    if(!d || !d.channels || !d.channels.length) return 'geral';
    var i, c;
    for(i = 0; i < d.channels.length; i++) {
      c = d.channels[i];
      if(chanKey(c) === 'geral' && c.kind === 'text') return c.id;
    }
    for(i = 0; i < d.channels.length; i++) {
      if(d.channels[i].kind === 'text') return d.channels[i].id;
    }
    for(i = 0; i < d.channels.length; i++) {
      if(d.channels[i].kind === 'voice') return d.channels[i].id;
    }
    return d.channels[0].id;
  }

  function nickStore(base) {
    var nick = (cred().user || '').toLowerCase() || 'anon';
    return base + ':' + nick;
  }
  function readMap(base) {
    try { return JSON.parse(localStorage.getItem(nickStore(base)) || '{}') || {}; } catch(e) { return {}; }
  }
  function writeMap(base, obj) {
    try { localStorage.setItem(nickStore(base), JSON.stringify(obj || {})); } catch(e) {}
  }
  function seenKey(sid, cid) { return String(sid || '') + ':' + String(cid || ''); }
  function textSeenMap() { return readMap('spartanTextSeen'); }
  function markSeen(sid, cid, n) {
    if(!sid || !cid) return;
    var m = textSeenMap();
    m[seenKey(sid, cid)] = n | 0;
    writeMap('spartanTextSeen', m);
  }
  function seenCount(sid, cid) {
    var m = textSeenMap();
    var v = m[seenKey(sid, cid)];
    return v == null ? null : (v | 0);
  }
  function isNoAuto(sid, cid) {
    return !!readMap('spartanTextNoAuto')[seenKey(sid, cid)];
  }
  function setNoAuto(sid, cid, on) {
    var m = readMap('spartanTextNoAuto');
    var k = seenKey(sid, cid);
    if(on) m[k] = true; else delete m[k];
    writeMap('spartanTextNoAuto', m);
  }
  function isServerMuted(sid) {
    return !!readMap('spartanServerMute')[String(sid || '')];
  }
  function setServerMuted(sid, on) {
    var m = readMap('spartanServerMute');
    sid = String(sid || '');
    if(!sid) return;
    if(on) m[sid] = true; else delete m[sid];
    writeMap('spartanServerMute', m);
  }
  function headsOf(sid) {
    var i;
    for(i = 0; i < listCache.length; i++) {
      if(listCache[i].id === sid) return listCache[i].text_heads || {};
    }
    return {};
  }
  function headCount(sid, cid) {
    var h = headsOf(sid)[cid];
    if(h && typeof h.n === 'number') return h.n | 0;
    return 0;
  }
  function hasUnread(sid, cid) {
    var seen = seenCount(sid, cid);
    if(seen == null) return false;
    return headCount(sid, cid) > seen;
  }
  function serverHasUnread(sid) {
    var heads = headsOf(sid), cid;
    for(cid in heads) {
      if(hasUnread(sid, cid)) return true;
    }
    return false;
  }
  function currentUnreadCids() {
    var heads = headsOf(current.server), cid, out = [];
    for(cid in heads) {
      if(hasUnread(current.server, cid)) out.push(cid);
    }
    return out;
  }
  function msgSoundOn() {
    var p = shellSounds();
    return !p || p.mensagem !== false;
  }
  function playMsgSound() {
    if(!msgSoundOn()) return;
    var now = Date.now();
    if(playMsgSound._t && now - playMsgSound._t < 2500) return;
    playMsgSound._t = now;
    try {
      var a = new Audio('/sounds/mensagem.mp3?v=1');
      a.volume = 0.35;
      a.play().catch(function() {});
    } catch(e) {}
  }
  function updateChatFab() {
    var btn = $('spartan-text-show');
    var badge = $('spartan-text-badge');
    if(badge) { badge.hidden = true; badge.textContent = ''; }
    if(!btn) return;
    var n = currentUnreadCids().length;
    if(textOpen || !n || !current.server) { btn.hidden = true; return; }
    btn.hidden = false;
    btn.textContent = n > 1 ? ('Chat · ' + n) : 'Chat';
  }
  function paintNoAuto() {
    var el = $('spartan-text-quiet');
    if(!el || !current.server || !current.channel) return;
    var off = isNoAuto(current.server, current.channel);
    el.textContent = off ? 'Abrir sozinho' : 'Não abrir sozinho';
    el.setAttribute('aria-pressed', off ? 'true' : 'false');
    el.title = off ? 'Este chat não abre sozinho. Clique para abrir quando chegar mensagem.' : 'Clique para este chat não abrir sozinho.';
  }
  function applyTextHeads(list) {
    var autoCh = null;
    var sounded = false;
    (list || []).forEach(function(s) {
      var sid = s.id;
      var heads = s.text_heads || {};
      var cid, n, seen, key, grew;
      for(cid in heads) {
        n = (heads[cid] && heads[cid].n) | 0;
        key = seenKey(sid, cid);
        seen = seenCount(sid, cid);
        if(seen == null) {
          markSeen(sid, cid, n);
          textAlerted[key] = n;
          continue;
        }
        grew = n > seen;
        if(!grew) continue;
        if((textAlerted[key] || 0) >= n) continue;
        textAlerted[key] = n;
        if(sid === current.server) {
          if(textOpen && current.channel === cid) {
            markSeen(sid, cid, n);
            continue;
          }
          if(!isNoAuto(sid, cid) && !textOpen && !autoCh) autoCh = cid;
          if(!sounded) { playMsgSound(); sounded = true; }
        } else if(!isServerMuted(sid)) {
          if(!sounded) { playMsgSound(); sounded = true; }
        }
      }
    });
    if(autoCh) {
      var ch = channelOf(autoCh);
      if(ch) showText(ch);
    }
    updateChatFab();
  }

  function showLeave(title) {
    var el = $('spartan-leave-call');
    if(!el) return;
    el.textContent = title ? ('Saindo de ' + title + '…') : 'Saindo da call…';
    el.hidden = false;
    clearTimeout(showLeave._t);
    showLeave._t = setTimeout(function() { el.hidden = true; }, 1800);
  }

  function setFrame(group, afk) {
    var frame = $('spartan-room-frame');
    if(!frame || !group) return;
    var src = '/group/' + encodeURIComponent(group) + '/?shell=1' + (afk ? '&afk=1' : '');
    if(frame.getAttribute('src') !== src) frame.setAttribute('src', src);
    frame.hidden = false;
    paintStage();
  }

  function paintStage() {
    var frame = $('spartan-room-frame');
    var inVoice = !!current.voice;
    if(frame && !inVoice) frame.hidden = true;
    document.documentElement.classList.toggle('spartan-voice-off', !inVoice);
  }

  function pingHere(leave, cid, sid) {
    var c = cred();
    sid = sid || current.server;
    var ch = cid || current.channel;
    if(!c.user || !sid || !ch) return;
    apiPost('/server-here', {
      user: c.user, password: c.pass,
      server: sid, channel: ch, leave: !!leave,
    }).catch(function() {});
  }

  function cmdFrame(cmd, extra) {
    var frame = $('spartan-room-frame');
    if(!frame || !frame.contentWindow) return;
    var msg = { t: 'spartan-shell-cmd', cmd: cmd };
    if(extra) {
      var k;
      for(k in extra) msg[k] = extra[k];
    }
    try { frame.contentWindow.postMessage(msg, location.origin); } catch(e) {}
  }

  function frameAlive() {
    var frame = $('spartan-room-frame');
    if(!frame) return false;
    var src = frame.getAttribute('src') || '';
    if(!src || src === 'about:blank') return false;
    return !frame.hidden;
  }

  function openSettings() {
    hideTextPane();
    // Sempre a telinha minimalista do shell — nunca o painel antigo da sala no iframe.
    try { document.documentElement.classList.remove('spartan-settings-up'); } catch(e) {}
    openShellSettings();
  }

  function closeShellSettings() {
    var el = $('spartan-shell-settings');
    if(el) el.hidden = true;
  }

  function shellPrefs() {
    try { return JSON.parse(localStorage.getItem('spartanPrefs') || '{}') || {}; } catch(e) { return {}; }
  }

  function saveShellPrefs(p) {
    try { localStorage.setItem('spartanPrefs', JSON.stringify(p)); } catch(e) {}
  }

  function shellSounds() {
    var nick = (cred().user || '').toLowerCase();
    try {
      if(nick) {
        var raw = localStorage.getItem('spartanSounds:' + nick);
        if(raw) return JSON.parse(raw);
      }
      var g = localStorage.getItem('spartanSounds');
      if(g) return JSON.parse(g);
    } catch(e) {}
    return {entrar: true, sair: true, mensagem: true};
  }

  function saveShellSounds(p) {
    var nick = (cred().user || '').toLowerCase();
    try {
      if(nick) localStorage.setItem('spartanSounds:' + nick, JSON.stringify(p));
      else localStorage.setItem('spartanSounds', JSON.stringify(p));
    } catch(e) {}
  }

  function refreshShellAdminBtn() {
    var admin = $('spartan-shell-admin');
    if(!admin) return;
    admin.hidden = true;
    var c = cred();
    if(!c.user || !c.pass) return;
    apiPost('/can-panel', { user: c.user, password: c.pass }).then(function(j) {
      var ok = !!(j && j.ok && (j.scope === 'admin' || j.scope === 'mod'));
      admin.hidden = !ok;
      if(ok)
        admin.textContent = j.scope === 'mod' ? 'Painel (moderador)' : 'Painel Admin';
    }).catch(function() { admin.hidden = true; });
  }

  function openShellSettings() {
    var el = $('spartan-shell-settings');
    if(!el) return;
    el.hidden = false;
    var prefs = shellPrefs();
    var q = $('spartan-shell-shareq');
    if(q) q.value = prefs.shareQuality || 'auto';
    var snd = shellSounds();
    var a = $('spartan-shell-snd-in'), b = $('spartan-shell-snd-out'), c = $('spartan-shell-snd-msg');
    if(a) a.checked = snd.entrar !== false;
    if(b) b.checked = snd.sair !== false;
    if(c) c.checked = snd.mensagem !== false;
    refreshShellAdminBtn();
  }

  function bindShellSettings() {
    var el = $('spartan-shell-settings');
    var close = $('spartan-shell-settings-close');
    var admin = $('spartan-shell-admin');
    var chpw = $('spartan-shell-chpw');
    var q = $('spartan-shell-shareq');
    if(el && !el.dataset.bound) {
      el.dataset.bound = '1';
      el.addEventListener('click', function(ev) { if(ev.target === el) closeShellSettings(); });
      document.addEventListener('keydown', function(ev) {
        if(ev.key === 'Escape' && el && !el.hidden) {
          ev.preventDefault();
          closeShellSettings();
        }
      });
    }
    if(close && !close.dataset.bound) {
      close.dataset.bound = '1';
      close.addEventListener('click', closeShellSettings);
    }
    if(admin && !admin.dataset.bound) {
      admin.dataset.bound = '1';
      admin.addEventListener('click', function() {
        closeShellSettings();
        if(window.SpartanApp && typeof window.SpartanApp.openAdmin === 'function')
          window.SpartanApp.openAdmin();
      });
    }
    if(chpw && !chpw.dataset.bound) {
      chpw.dataset.bound = '1';
      chpw.addEventListener('click', function() {
        var c = cred();
        fetch('/spartan-api/site', { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(site) {
          var g = (site && site.main) || 'spartan';
          location.href = '/change-password.html?group=' + encodeURIComponent(g) + '&username=' + encodeURIComponent(c.user || '');
        }).catch(function() {
          location.href = '/change-password.html?group=spartan&username=' + encodeURIComponent((cred().user || ''));
        });
      });
    }
    if(q && !q.dataset.bound) {
      q.dataset.bound = '1';
      q.addEventListener('change', function() {
        var p = shellPrefs();
        p.shareQuality = q.value || 'auto';
        saveShellPrefs(p);
      });
    }
    ['spartan-shell-snd-in','spartan-shell-snd-out','spartan-shell-snd-msg'].forEach(function(id) {
      var box = $(id);
      if(!box || box.dataset.bound) return;
      box.dataset.bound = '1';
      box.addEventListener('change', function() {
        saveShellSounds({
          entrar: !($('spartan-shell-snd-in') && !$('spartan-shell-snd-in').checked),
          sair: !($('spartan-shell-snd-out') && !$('spartan-shell-snd-out').checked),
          mensagem: !($('spartan-shell-snd-msg') && !$('spartan-shell-snd-msg').checked),
        });
      });
    });
  }

  function paintUserBar() {
    var el = $('spartan-user-bar');
    if(!el) return;
    var c = cred();
    var nick = mediaState.nick || c.user || '';
    var av = $('spartan-user-avatar');
    var nm = $('spartan-user-nick');
    var vs = $('spartan-user-voice');
    var mic = $('spartan-user-mic');
    var share = $('spartan-user-share');
    var cam = $('spartan-user-cam');
    if(av) av.textContent = ((nick.charAt(0) || '?')).toUpperCase();
    if(nm) nm.textContent = nick || 'você';
    if(vs) {
      if(current.voiceTitle && current.voiceServer && current.voiceServer !== current.server)
        vs.textContent = current.voiceTitle + ' · ' + (current.voiceServerTitle || current.voiceServer);
      else vs.textContent = current.voiceTitle || '';
    }
    el.hidden = !c.user && !nick;
    if(mic) {
      mic.classList.toggle('on', !!mediaState.mic);
      mic.classList.toggle('off', !mediaState.mic);
      mic.setAttribute('aria-pressed', mediaState.mic ? 'true' : 'false');
    }
    if(share) {
      share.classList.toggle('on', !!mediaState.share);
      share.setAttribute('aria-pressed', mediaState.share ? 'true' : 'false');
    }
    if(cam) {
      cam.classList.toggle('on', !!mediaState.cam);
      cam.setAttribute('aria-pressed', mediaState.cam ? 'true' : 'false');
    }
  }

  function peopleIn(cid) {
    var out = [];
    var seen = {};
    ((detail && detail.people) || []).forEach(function(p) {
      if(p.channel === cid) {
        out.push(p);
        seen[String(p.nick || '').toLowerCase()] = true;
      }
    });
    if(cid && cid === current.voice && current.voiceServer === current.server) {
      var me = cred().user;
      if(me && !seen[me]) out.unshift({ nick: me });
    }
    return out;
  }

  function talkClass(mode) {
    if(mode === 'on') return 'user-talk-on';
    if(mode === 'idle') return 'user-talk-idle';
    if(mode === 'muted') return 'user-talk-muted';
    return '';
  }

  function applyTalkUsers(users) {
    talkByNick = {};
    (users || []).forEach(function(u) {
      if(u && u.nick) talkByNick[String(u.nick).toLowerCase()] = u.talk || 'off';
    });
    document.querySelectorAll('.spartan-chan-user').forEach(function(el) {
      var n = (el.getAttribute('data-nick') || '').toLowerCase();
      el.classList.remove('user-talk-on', 'user-talk-idle', 'user-talk-muted');
      var cls = talkClass(talkByNick[n] || 'off');
      if(cls) el.classList.add(cls);
    });
  }

  function liveCaption(list, i) {
    var lv = list[i];
    var want = lv.label === 'screenshare';
    var total = 0, idx = 0, j;
    for(j = 0; j < list.length; j++) {
      if((list[j].label === 'screenshare') === want) {
        total++;
        if(j === i) idx = total;
      }
    }
    if(want) return total <= 1 ? 'Tela' : ('Tela ' + idx);
    return total <= 1 ? 'Câmera' : ('Câmera ' + idx);
  }

  function paintUserExtras(who) {
    if(!who) return;
    var nick = (who.getAttribute('data-nick') || '').toLowerCase();
    var st = liveByNick[nick] || {};
    var lives = st.lives || [];
    var ident = who.querySelector('.spartan-chan-ident');
    var box = who.querySelector('.spartan-user-lives');
    if(!box) {
      box = document.createElement('div');
      box.className = 'spartan-user-lives';
      who.appendChild(box);
    }
    var wantIds = lives.map(function(lv) { return String(lv.id || ''); }).join(',');
    if(box.dataset.liveIds === wantIds && box.children.length === lives.length) {
      lives.forEach(function(lv, i) {
        var b = box.children[i];
        if(!b) return;
        if(lv.on) b.classList.add('on');
        else b.classList.remove('on');
        b.textContent = liveCaption(lives, i);
        b.setAttribute('data-live-id', lv.id || '');
      });
    } else {
      box.dataset.liveIds = wantIds;
      box.innerHTML = '';
      lives.forEach(function(lv, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'user-live-btn' + (lv.on ? ' on' : '');
        b.textContent = liveCaption(lives, i);
        b.setAttribute('data-live-id', lv.id || '');
        b.addEventListener('click', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var id = b.getAttribute('data-live-id');
          if(id) cmdFrame('watch', {
            id: id,
            userId: st.id || '',
            liveKey: lv.liveKey || '',
          });
        });
        box.appendChild(b);
      });
    }
    box.hidden = !lives.length;
    var aud = who.querySelector('.spartan-user-audio');
    if(st.me) {
      if(ident) {
        var selfMute = ident.querySelector('.user-mute-btn');
        if(selfMute) selfMute.remove();
      }
      if(aud) aud.remove();
      who.classList.remove('vol-open');
      return;
    }
    if(ident) {
      var mute = ident.querySelector('.user-mute-btn');
      if(!mute) {
        mute = document.createElement('button');
        mute.type = 'button';
        mute.className = 'user-mute-btn';
        mute.textContent = 'Mudo';
        mute.addEventListener('click', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var now = liveByNick[nick] || st;
          if(now.id) cmdFrame('mute', { userId: now.id });
        });
        ident.appendChild(mute);
      }
      mute.classList.remove('mute-local', 'mute-remote', 'mute-both');
      if(st.muteLocal && st.muteRemote) mute.classList.add('mute-both');
      else if(st.muteLocal) mute.classList.add('mute-local');
      else if(st.muteRemote) mute.classList.add('mute-remote');
      mute.title = st.muteRemote
        ? (st.muteLocal ? 'Você não ouve (amarelo) e o microfone dele está desligado (vermelho)' : 'Microfone desligado (ele ou um admin)')
        : 'Mudo só no seu fone';
    }
    if(volOpenNick === nick) {
      who.classList.add('vol-open');
      if(!aud) {
        aud = document.createElement('div');
        aud.className = 'spartan-user-audio';
        who.appendChild(aud);
      }
      var vol = st.vol == null ? 100 : Number(st.vol);
      if(!(vol >= 0)) vol = 100;
      vol = Math.max(0, Math.min(400, Math.round(vol / 5) * 5));
      var sl = aud.querySelector('.user-vol-slider');
      var lab = aud.querySelector('.user-vol-lab');
      if(!sl) {
        aud.innerHTML = '';
        sl = document.createElement('input');
        sl.type = 'range';
        sl.min = '0';
        sl.max = '400';
        sl.step = '5';
        sl.className = 'user-vol-slider';
        sl.title = 'Volume (seu fone)';
        lab = document.createElement('span');
        lab.className = 'user-vol-lab';
        function sendVol() {
          var v = parseInt(sl.value, 10) || 0;
          v = Math.max(0, Math.min(400, Math.round(v / 5) * 5));
          sl.value = String(v);
          lab.textContent = v + '%';
          var now = liveByNick[nick] || st;
          if(now.id) cmdFrame('vol', { userId: now.id, vol: v });
        }
        sl.addEventListener('input', function(ev) {
          ev.stopPropagation();
          sendVol();
        });
        sl.addEventListener('change', function(ev) {
          ev.stopPropagation();
          sendVol();
        });
        sl.addEventListener('click', function(ev) { ev.stopPropagation(); });
        sl.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
        sl.addEventListener('wheel', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var cur = parseInt(sl.value, 10) || 0;
          var next = cur + (ev.deltaY < 0 ? 5 : -5);
          next = Math.max(0, Math.min(400, next));
          sl.value = String(next);
          sendVol();
        }, { passive: false });
        aud.appendChild(sl);
        aud.appendChild(lab);
      }
      if(document.activeElement !== sl) {
        sl.value = String(vol);
        lab.textContent = vol + '%';
      } else {
        lab.textContent = (parseInt(sl.value, 10) || 0) + '%';
      }
    } else {
      who.classList.remove('vol-open');
      if(aud) aud.remove();
    }
  }

  function applyRoster(users) {
    liveByNick = {};
    (users || []).forEach(function(u) {
      if(u && u.nick) liveByNick[String(u.nick).toLowerCase()] = u;
    });
    applyTalkUsers(users);
    document.querySelectorAll('.spartan-chan-user').forEach(paintUserExtras);
  }

  function paintGuilds() {
    var rail = $('spartan-guild-rail');
    if(!rail) return;
    rail.innerHTML = '';
    listCache.forEach(function(s) {
      var b = document.createElement('button');
      b.type = 'button';
      var extra = '';
      if(s.id === current.server) extra += ' on';
      if(isServerMuted(s.id)) extra += ' muted';
      if(serverHasUnread(s.id)) extra += isServerMuted(s.id) ? ' unread-quiet' : ' unread';
      b.className = 'spartan-guild-btn' + extra;
      b.title = (s.title || s.id) + (isServerMuted(s.id) ? ' (silenciado)' : '') + ' — botão direito silencia o servidor';
      b.textContent = ((s.title || s.id || '?').trim().charAt(0) || '?').toUpperCase();
      b.addEventListener('click', function() {
        if(s.id === current.server) return;
        if(window.SpartanApp) window.SpartanApp.goServer(s.id, defaultChannel(s._full || s));
      });
      b.addEventListener('contextmenu', function(ev) {
        ev.preventDefault();
        setServerMuted(s.id, !isServerMuted(s.id));
        paintGuilds();
      });
      rail.appendChild(b);
    });
  }

  function canManage() {
    return detail && (detail.my_role === 'admin' || detail.my_role === 'mod');
  }

  function paintChannels() {
    var box = $('spartan-channel-list');
    var title = $('spartan-server-title');
    if(title) title.textContent = (detail && detail.title) || current.server || 'Servidor';
    if(!box) return;
    box.innerHTML = '';
    if(!detail) return;
    var cats = detail.categories && detail.categories.length
      ? detail.categories
      : [{ id: 'texto', title: 'Canais de texto' }, { id: 'voz', title: 'Canais de voz' }];
    cats.forEach(function(cat) {
      var wrap = document.createElement('div');
      wrap.className = 'spartan-chan-cat';
      var h = document.createElement('h3');
      h.textContent = cat.title || cat.id;
      wrap.appendChild(h);
      (detail.channels || []).forEach(function(ch) {
        if((ch.category || '') !== cat.id) return;
        var row = document.createElement('div');
        row.className = 'spartan-chan-row';
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'spartan-chan-btn' + (ch.id === current.channel ? ' on' : '');
        if(ch.kind === 'voice' && ch.id === current.voice && current.voiceServer === current.server) b.classList.add('live');
        if(ch.kind === 'text' && hasUnread(current.server, ch.id)) b.classList.add('unread');
        var prefix = ch.kind === 'text' ? '# ' : '🔊 ';
        if(ch.afk || chanKey(ch) === 'ausentes') prefix = '🔇 ';
        b.textContent = prefix + (ch.title || ch.id);
        b.addEventListener('click', function() { pickChannel(ch); });
        row.addEventListener('dragover', function(ev) { ev.preventDefault(); row.classList.add('drop'); });
        row.addEventListener('dragleave', function() { row.classList.remove('drop'); });
        row.addEventListener('drop', function(ev) {
          ev.preventDefault();
          row.classList.remove('drop');
          if(ch.kind === 'voice') {
            var nick = ev.dataTransfer.getData('text/plain') || '';
            if(nick && nick.indexOf('chan:') !== 0) moveUser(nick, ch.id);
          }
        });
        row.appendChild(b);
        if(ch.kind === 'voice') {
          peopleIn(ch.id).forEach(function(p) {
            var nick = p.nick || '';
            var who = document.createElement('div');
            who.className = 'spartan-chan-user';
            who.setAttribute('data-nick', nick.toLowerCase());
            var cls = talkClass(talkByNick[nick.toLowerCase()] || 'off');
            if(cls) who.classList.add(cls);
            var av = document.createElement('span');
            av.className = 'spartan-chan-avatar';
            av.textContent = ((nick.charAt(0) || '?')).toUpperCase();
            var dot = document.createElement('span');
            dot.className = 'spartan-talk-dot';
            dot.setAttribute('aria-hidden', 'true');
            var nm = document.createElement('span');
            nm.className = 'spartan-chan-nick';
            nm.textContent = nick;
            var ident = document.createElement('span');
            ident.className = 'spartan-chan-ident';
            ident.appendChild(av);
            ident.appendChild(dot);
            ident.appendChild(nm);
            who.appendChild(ident);
            who.draggable = false;
            who.addEventListener('click', function(ev) {
              if(ev.target.closest && ev.target.closest('.user-live-btn, .user-mute-btn, .user-vol-slider, .user-vol-lab, .spartan-user-audio')) return;
              var key = nick.toLowerCase();
              var st = liveByNick[key] || {};
              if(st.me) return;
              volOpenNick = (volOpenNick === key) ? '' : key;
              document.querySelectorAll('.spartan-chan-user').forEach(paintUserExtras);
            });
            paintUserExtras(who);
            row.appendChild(who);
          });
        }
        wrap.appendChild(row);
      });
      if(wrap.children.length > 1) box.appendChild(wrap);
    });
  }

  function paintPeople() {
    var box = $('spartan-people-list');
    if(!box) return;
    box.innerHTML = '';
    var roster = (detail && detail.roster) || (detail && detail.people) || [];
    if(!roster.length) {
      var empty = document.createElement('p');
      empty.className = 'spartan-people-empty';
      empty.textContent = 'Ninguém no servidor.';
      box.appendChild(empty);
      return;
    }
    var on = roster.filter(function(p) { return p.online !== false; });
    var off = roster.filter(function(p) { return p.online === false; });
    function head(label) {
      var h = document.createElement('h4');
      h.className = 'spartan-people-sec';
      h.textContent = label;
      box.appendChild(h);
    }
    function row(p, online) {
      var el = document.createElement('div');
      el.className = 'spartan-people-card' + (online ? '' : ' off');
      el.draggable = false;
      var av = document.createElement('span');
      av.className = 'spartan-people-av';
      av.textContent = ((p.nick || '?').charAt(0) || '?').toUpperCase();
      var name = document.createElement('strong');
      name.textContent = p.nick || '';
      el.appendChild(av);
      el.appendChild(name);
      box.appendChild(el);
    }
    head('Online — ' + on.length);
    if(!on.length) {
      var e1 = document.createElement('p');
      e1.className = 'spartan-people-empty';
      e1.textContent = 'Ninguém online.';
      box.appendChild(e1);
    } else on.forEach(function(p) { row(p, true); });
    head('Offline — ' + off.length);
    if(!off.length) {
      var e2 = document.createElement('p');
      e2.className = 'spartan-people-empty';
      e2.textContent = 'Ninguém offline.';
      box.appendChild(e2);
    } else off.forEach(function(p) { row(p, false); });
  }

  function moveUser(nick, cid) {
    if(!canManage() || !nick || !cid) return;
    var cr = cred();
    apiPost('/server-move', {
      user: cr.user, password: cr.pass, server: current.server, nick: nick, channel: cid,
    }).catch(function() {});
  }

  function applyReloc(d) {
    var me = cred().user;
    var r = d && d.my_reloc;
    if(!r || !r.channel || !me) return;
    var ch = channelOf(r.channel);
    if(!ch || ch.kind !== 'voice') return;
    if(current.voice && current.voiceServer && current.voiceServer !== current.server) {
      ackMoved(ch.id);
      return;
    }
    if(current.voice === ch.id) {
      ackMoved(ch.id);
      return;
    }
    joinVoice(ch, true);
    ackMoved(ch.id);
  }

  function ackMoved(cid) {
    var cr = cred();
    apiPost('/server-moved', { user: cr.user, password: cr.pass, server: current.server, channel: cid }).catch(function() {});
  }

  function joinVoice(ch, silent) {
    if(!ch || ch.kind !== 'voice') return;
    var sid = current.server;
    var same = current.voice === ch.id && current.voiceServer === sid && current.voiceGroup === (ch.group || '');
    if(same) {
      current.channel = ch.id;
      hideTextPane();
      paintChannels();
      syncHash();
      return;
    }
    if(current.voice && current.voiceTitle && !silent) showLeave(current.voiceTitle);
    if(current.voice && current.voiceServer && (current.voiceServer !== sid || current.voice !== ch.id))
      pingHere(true, current.voice, current.voiceServer);
    current.voice = ch.id;
    current.voiceGroup = ch.group;
    current.voiceTitle = ch.title || ch.id;
    current.voiceServer = sid;
    current.voiceServerTitle = (detail && detail.title) || sid;
    current.channel = ch.id;
    hideTextPane();
    setFrame(ch.group, !!(ch.afk || chanKey(ch) === 'ausentes'));
    pingHere(false, ch.id, sid);
    paintUserBar();
    paintStage();
    paintChannels();
    syncHash();
  }

  function showText(ch) {
    var pane = $('spartan-text-pane');
    var title = $('spartan-text-title');
    var showBtn = $('spartan-text-show');
    current.channel = ch.id;
    if(title) title.textContent = '# ' + (ch.title || ch.id);
    textOpen = true;
    if(pane) pane.hidden = false;
    if(showBtn) showBtn.hidden = true;
    document.documentElement.classList.remove('spartan-text-collapsed');
    document.documentElement.classList.add('spartan-text-open');
    paintNoAuto();
    loadText(true);
    pingHere(false, ch.id, current.server);
    paintStage();
    paintChannels();
    updateChatFab();
    syncHash();
  }

  function liveBusy() {
    if(mediaState.share || mediaState.cam) return true;
    var nick, st, lives, i, lv;
    for(nick in liveByNick) {
      st = liveByNick[nick] || {};
      lives = st.lives || [];
      for(i = 0; i < lives.length; i++) {
        lv = lives[i];
        if(lv && lv.on && !lv.up) return true;
      }
    }
    return false;
  }

  function hideSwitchAsk() {
    var el = $('spartan-switch-ask');
    if(el) el.hidden = true;
    switchPending = null;
  }

  function hideInviteAsk() {
    var el = $('spartan-invite-ask');
    if(el) el.hidden = true;
    var yes = $('spartan-invite-yes');
    if(yes) yes.hidden = false;
    invitePending = null;
  }

  function denyInvite() {
    hideInviteAsk();
    try { sessionStorage.removeItem('spartanPendingInvite'); } catch(e) {}
    if(current.server) {
      if(window.SpartanApp) window.SpartanApp.goServer(current.server, current.channel || 'geral');
      else history.replaceState(null, '', '#/s/' + encodeURIComponent(current.server) + '/' + encodeURIComponent(current.channel || 'geral'));
      return;
    }
    refreshList().then(function() {
      var first = listCache[0] && listCache[0].id;
      if(first && window.SpartanApp) window.SpartanApp.goServer(first, 'geral');
      else history.replaceState(null, '', '#/');
    });
  }

  function acceptInvite() {
    var pend = invitePending;
    hideInviteAsk();
    if(!pend || !pend.code) return;
    var cr = cred();
    apiPost('/server-join', { user: cr.user, password: cr.pass, invite: pend.code }).then(function(j) {
      try { sessionStorage.removeItem('spartanPendingInvite'); } catch(e) {}
      if(window.SpartanApp) window.SpartanApp.goServer(j.id, 'geral');
      else openServer(j.id, 'geral');
    }).catch(function(err) {
      var hint = $('spartan-channel-hint');
      if(hint) { hint.hidden = false; hint.textContent = err.message || 'Não entrou.'; }
    });
  }

  function showInviteAsk(title, msg, pending) {
    invitePending = pending || null;
    var el = $('spartan-invite-ask');
    var t = $('spartan-invite-ask-title');
    var p = $('spartan-invite-ask-msg');
    var yes = $('spartan-invite-yes');
    if(t) t.textContent = title || 'Convite para outro servidor';
    if(p) p.textContent = msg || '';
    if(yes) yes.hidden = !pending;
    bindInviteAsk();
    if(el) el.hidden = false;
  }

  function handleInvite(code) {
    code = (code || '').trim();
    if(!code) return false;
    var c = cred();
    if(!c.user || !c.pass) {
      try { sessionStorage.setItem('spartanPendingInvite', code); } catch(e) {}
      return false;
    }
    try { sessionStorage.setItem('spartanPendingInvite', code); } catch(e) {}
    bindInviteAsk();
    apiGet('/server-invite?code=' + encodeURIComponent(code)).then(function(info) {
      if(info && info.id && current.server === info.id) {
        try { sessionStorage.removeItem('spartanPendingInvite'); } catch(e) {}
        if(window.SpartanApp) window.SpartanApp.goServer(info.id, current.channel || 'geral');
        return;
      }
      var name = (info && (info.title || info.id)) || 'outro servidor';
      showInviteAsk(
        'Convite para outro servidor',
        'Você foi convidado para ' + name + '. Quer entrar?',
        { code: code, id: info && info.id, title: name }
      );
    }).catch(function() {
      try { sessionStorage.removeItem('spartanPendingInvite'); } catch(e) {}
      showInviteAsk('Convite inválido', 'Esse link não vale mais. Peça um novo para o admin.', null);
    });
    return true;
  }

  function bindInviteAsk() {
    var ask = $('spartan-invite-ask');
    var no = $('spartan-invite-no');
    var yes = $('spartan-invite-yes');
    if(ask && !ask.dataset.bound) {
      ask.dataset.bound = '1';
      ask.addEventListener('click', function(ev) {
        if(ev.target === ask) denyInvite();
      });
      document.addEventListener('keydown', function(ev) {
        if(ev.key === 'Escape' && ask && !ask.hidden) {
          ev.preventDefault();
          denyInvite();
        }
      });
    }
    if(no && !no.dataset.bound) {
      no.dataset.bound = '1';
      no.addEventListener('click', denyInvite);
    }
    if(yes && !yes.dataset.bound) {
      yes.dataset.bound = '1';
      yes.addEventListener('click', acceptInvite);
    }
  }

  function askSwitchVoice(ch) {
    switchPending = ch;
    var el = $('spartan-switch-ask');
    var title = $('spartan-switch-title');
    if(title)
      title.textContent = 'Trocar para ' + (ch.title || ch.id) + '?';
    if(!el) {
      joinVoice(ch, false);
      return;
    }
    el.hidden = false;
  }

  function pickChannel(ch) {
    if(!ch) return;
    if(ch.kind === 'voice') {
      if(current.voice === ch.id && current.voiceGroup === (ch.group || '') && current.server === ((detail && detail.id) || current.server)) {
        current.channel = ch.id;
        hideTextPane();
        paintChannels();
        syncHash();
        return;
      }
      if(current.voice && liveBusy()) {
        askSwitchVoice(ch);
        return;
      }
      joinVoice(ch, false);
      return;
    }
    showText(ch);
  }

  function hideTextPane() {
    var pane = $('spartan-text-pane');
    textOpen = false;
    if(pane) pane.hidden = true;
    document.documentElement.classList.add('spartan-text-collapsed');
    document.documentElement.classList.remove('spartan-text-open');
    updateChatFab();
  }

  function scrollTextToLatest(log) {
    if(!log) log = $('spartan-text-log');
    if(!log) return;
    function go() { log.scrollTop = log.scrollHeight; }
    go();
    requestAnimationFrame(function() {
      go();
      requestAnimationFrame(go);
    });
    setTimeout(go, 40);
    setTimeout(go, 250);
    log.querySelectorAll('img, video').forEach(function(el) {
      el.addEventListener('load', go);
      el.addEventListener('loadeddata', go);
    });
  }

  function loadText(fromPick) {
    var log = $('spartan-text-log');
    var ch = channelOf(current.channel);
    if(!log || !current.server || !ch || ch.kind !== 'text') return;
    var c = cred();
    var q = '/server-text?server=' + encodeURIComponent(current.server) +
      '&channel=' + encodeURIComponent(current.channel) +
      '&user=' + encodeURIComponent(c.user || '');
    apiGet(q).then(function(j) {
      var msgs = j.messages || [];
      lastTextCount = msgs.length;
      if(textOpen && current.server && current.channel)
        markSeen(current.server, current.channel, msgs.length);
      var stick = !!fromPick || !log.childNodes.length ||
        (log.scrollHeight - log.scrollTop - log.clientHeight) < 90;
      log.innerHTML = '';
      msgs.forEach(function(m) {
        var p = document.createElement('p');
        var who = document.createElement('strong');
        who.textContent = m.nick || '';
        p.appendChild(who);
        if(m.text) p.appendChild(document.createTextNode(' ' + m.text));
        if(m.file && m.file.id) {
          var url = API + '/server-file?id=' + encodeURIComponent(m.file.id) +
            '&server=' + encodeURIComponent(current.server) +
            '&user=' + encodeURIComponent(c.user || '');
          var kind = m.file.kind || '';
          if(kind === 'image') {
            var img = document.createElement('img');
            img.className = 'spartan-chat-img';
            img.alt = m.file.name || 'imagem';
            img.src = url;
            p.appendChild(document.createElement('br'));
            p.appendChild(img);
          } else if(kind === 'video') {
            var vid = document.createElement('video');
            vid.className = 'spartan-chat-vid';
            vid.controls = true;
            vid.src = url;
            p.appendChild(document.createElement('br'));
            p.appendChild(vid);
          } else if(kind === 'audio') {
            var aud = document.createElement('audio');
            aud.controls = true;
            aud.src = url;
            p.appendChild(document.createElement('br'));
            p.appendChild(aud);
          } else {
            var a = document.createElement('a');
            a.href = url;
            a.textContent = m.file.name || 'arquivo';
            a.target = '_blank';
            a.rel = 'noopener';
            p.appendChild(document.createTextNode(' '));
            p.appendChild(a);
          }
        }
        log.appendChild(p);
      });
      if(stick) scrollTextToLatest(log);
    }).catch(function() {});
  }

  function inList(sid) {
    var i;
    for(i = 0; i < listCache.length; i++) {
      if(listCache[i].id === sid) return true;
    }
    return false;
  }

  function dropCall() {
    var frame = $('spartan-room-frame');
    if(frame) {
      frame.hidden = true;
      frame.setAttribute('src', 'about:blank');
    }
    current.voice = null;
    current.voiceGroup = null;
    current.voiceTitle = '';
    current.voiceServer = null;
    current.voiceServerTitle = '';
    paintStage();
    paintUserBar();
  }

  function dropServer(sid) {
    if(current.voiceServer === sid) dropCall();
    if(current.server === sid) {
      refreshList().then(function() {
        var first = listCache[0] && listCache[0].id;
        if(first) openServer(first, 'geral');
        else if(window.SpartanApp) window.SpartanApp.goHome();
      });
    } else paintGuilds();
  }

  function ackKick(sid) {
    var cr = cred();
    if(!cr.user || !sid) return;
    apiPost('/server-kicked', { user: cr.user, password: cr.pass, server: sid }).catch(function() {});
  }

  function syncHash() {
    if(!current.server || !current.channel) return;
    var want = '#/s/' + encodeURIComponent(current.server) + '/' + encodeURIComponent(current.channel);
    if(location.hash !== want) {
      try { history.replaceState(null, '', want); } catch(e) {}
    }
  }

  function applyChannel(ch) {
    if(!ch) return;
    if(ch.kind === 'voice') {
      if(current.voice && current.voiceServer && current.voiceServer !== current.server) return;
      joinVoice(ch, true);
    } else showText(ch);
  }

  function openServer(sid, cid, groupHint) {
    var c = cred();
    sid = sid || current.server || 'spartan';
    if(current.server && current.server !== sid) {
      if(current.channel && (!current.voiceServer || current.server !== current.voiceServer || current.channel !== current.voice))
        pingHere(true, current.channel, current.server);
      hideSwitchAsk();
    }
    apiGet('/server?id=' + encodeURIComponent(sid) + '&user=' + encodeURIComponent(c.user || '')).then(function(d) {
      detail = d;
      current.server = d.id;
      var ch = null;
      if(groupHint) {
        (d.channels || []).some(function(x) {
          if(x.kind === 'voice' && x.group === groupHint) { ch = x; return true; }
          return false;
        });
      }
      if(!ch && cid) ch = channelOf(cid);
      if(!ch) ch = channelOf(defaultChannel(d));
      applyChannel(ch);
      paintGuilds();
      paintPeople();
      paintUserBar();
      applyReloc(d);
      var i;
      for(i = 0; i < listCache.length; i++) {
        if(listCache[i].id === d.id) { listCache[i]._full = d; listCache[i]._channels = d.channels; }
      }
      var cr = cred();
      if(cr.user && cr.pass) {
        apiPost('/server-view', { user: cr.user, password: cr.pass, server: d.id }).then(function(full) {
          detail = full;
          paintChannels();
          paintPeople();
          paintUserBar();
          applyReloc(full);
        }).catch(function() {});
      }
    }).catch(function(err) {
      if(err && err.status === 403) dropServer(sid);
      else if(groupHint) setFrame(groupHint, false);
    });
  }

  function refreshList() {
    var c = cred();
    return apiGet('/servers?user=' + encodeURIComponent(c.user || '')).then(function(j) {
      listCache = j.servers || [];
      applyTextHeads(listCache);
      paintGuilds();
      paintChannels();
      return listCache;
    }).catch(function() { return listCache; });
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(function() {
      if(!current.server) return;
      var c = cred();
      apiGet('/server?id=' + encodeURIComponent(current.server) + '&user=' + encodeURIComponent(c.user || '')).then(function(d) {
        if(d.my_kick) {
          ackKick(current.server);
          dropServer(current.server);
          return;
        }
        detail = d;
        paintChannels();
        paintPeople();
        paintUserBar();
        applyReloc(d);
        var ch = channelOf(current.channel);
        if(ch && ch.kind === 'text') {
          loadText(false);
          pingHere(false, ch.id, current.server);
        }
        if(current.voice && current.voiceServer)
          pingHere(false, current.voice, current.voiceServer);
      }).catch(function(err) {
        if(err && err.status === 403) dropServer(current.server);
      });
      refreshList().then(function() {
        if(current.voiceServer && !inList(current.voiceServer)) {
          ackKick(current.voiceServer);
          dropCall();
        }
        if(current.server && !inList(current.server)) dropServer(current.server);
      });
    }, 4000);
  }

  function stopPoll() {
    if(pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function bindChrome() {
    bindShellSettings();
    bindInviteAsk();
    if(!document.documentElement.dataset.volCloseBound) {
      document.documentElement.dataset.volCloseBound = '1';
      document.addEventListener('click', function(ev) {
        if(!volOpenNick) return;
        if(ev.target.closest && ev.target.closest('.spartan-chan-user')) return;
        volOpenNick = '';
        document.querySelectorAll('.spartan-chan-user').forEach(paintUserExtras);
      });
    }
    var ask = $('spartan-switch-ask');
    var stay = $('spartan-switch-stay');
    var go = $('spartan-switch-go');
    if(ask && !ask.dataset.bound) {
      ask.dataset.bound = '1';
      ask.addEventListener('click', function(ev) {
        if(ev.target === ask) hideSwitchAsk();
      });
      document.addEventListener('keydown', function(ev) {
        if(ev.key === 'Escape' && ask && !ask.hidden) {
          ev.preventDefault();
          hideSwitchAsk();
        }
      });
    }
    if(stay && !stay.dataset.bound) {
      stay.dataset.bound = '1';
      stay.addEventListener('click', hideSwitchAsk);
    }
    if(go && !go.dataset.bound) {
      go.dataset.bound = '1';
      go.addEventListener('click', function() {
        var ch = switchPending;
        hideSwitchAsk();
        if(ch) joinVoice(ch, false);
      });
    }
    var leaveAsk = $('spartan-leave-ask');
    var leaveNo = $('spartan-leave-no');
    var leaveYes = $('spartan-leave-yes');
    if(leaveAsk && !leaveAsk.dataset.bound) {
      leaveAsk.dataset.bound = '1';
      leaveAsk.addEventListener('click', function(ev) {
        if(ev.target === leaveAsk) hideLeaveAsk();
      });
      document.addEventListener('keydown', function(ev) {
        if(ev.key === 'Escape' && leaveAsk && !leaveAsk.hidden) {
          ev.preventDefault();
          hideLeaveAsk();
        }
      });
    }
    if(leaveNo && !leaveNo.dataset.bound) {
      leaveNo.dataset.bound = '1';
      leaveNo.addEventListener('click', hideLeaveAsk);
    }
    if(leaveYes && !leaveYes.dataset.bound) {
      leaveYes.dataset.bound = '1';
      leaveYes.addEventListener('click', doLogout);
    }
    var hideP = $('spartan-people-toggle');
    var showP = $('spartan-people-show');
    var hideT = $('spartan-text-hide');
    var showT = $('spartan-text-show');
    if(hideP && !hideP.dataset.bound) {
      hideP.dataset.bound = '1';
      hideP.addEventListener('click', function() {
        document.documentElement.classList.add('spartan-people-collapsed');
      });
    }
    if(showP && !showP.dataset.bound) {
      showP.dataset.bound = '1';
      showP.addEventListener('click', function() {
        document.documentElement.classList.remove('spartan-people-collapsed');
      });
    }
    if(hideT && !hideT.dataset.bound) {
      hideT.dataset.bound = '1';
      hideT.addEventListener('click', hideTextPane);
    }
    var quiet = $('spartan-text-quiet');
    if(quiet && !quiet.dataset.bound) {
      quiet.dataset.bound = '1';
      paintNoAuto();
      quiet.addEventListener('click', function() {
        if(!current.server || !current.channel) return;
        setNoAuto(current.server, current.channel, !isNoAuto(current.server, current.channel));
        paintNoAuto();
      });
    }
    if(showT && !showT.dataset.bound) {
      showT.dataset.bound = '1';
      showT.addEventListener('click', function() {
        var unread = currentUnreadCids();
        var ch = unread.length ? channelOf(unread[0]) : channelOf(current.channel);
        if(ch && ch.kind === 'text') showText(ch);
        else {
          var g = channelOf('geral');
          if(g) showText(g);
        }
      });
    }
    var micBtn = $('spartan-user-mic');
    var shareBtn = $('spartan-user-share');
    var camBtn = $('spartan-user-cam');
    var setBtn = $('spartan-user-settings');
    if(micBtn && !micBtn.dataset.bound) {
      micBtn.dataset.bound = '1';
      micBtn.addEventListener('click', function() { cmdFrame('mic'); });
    }
    if(shareBtn && !shareBtn.dataset.bound) {
      shareBtn.dataset.bound = '1';
      shareBtn.addEventListener('click', function() { cmdFrame('share'); });
    }
    if(camBtn && !camBtn.dataset.bound) {
      camBtn.dataset.bound = '1';
      camBtn.addEventListener('click', function() { cmdFrame('camera'); });
    }
    if(setBtn && !setBtn.dataset.bound) {
      setBtn.dataset.bound = '1';
      setBtn.addEventListener('click', openSettings);
    }
    if(!window._spartanMediaBound) {
      window._spartanMediaBound = true;
      window.addEventListener('message', function(ev) {
        if(ev.origin !== location.origin) return;
        var d = ev.data || {};
        if(d.t === 'spartan-media') {
          if(d.nick) mediaState.nick = d.nick;
          if(typeof d.mic === 'boolean') mediaState.mic = d.mic;
          if(typeof d.share === 'boolean') mediaState.share = d.share;
          if(typeof d.cam === 'boolean') mediaState.cam = d.cam;
          paintUserBar();
          return;
        }
        if(d.t === 'spartan-roster') {
          applyRoster(d.users);
          return;
        }
        if(d.t === 'spartan-talk') applyTalkUsers(d.users);
        if(d.t === 'spartan-settings')
          document.documentElement.classList.toggle('spartan-settings-up', !!d.open);
      });
    }
    var leaveBtn = $('spartan-user-leave');
    if(leaveBtn && !leaveBtn.dataset.bound) {
      leaveBtn.dataset.bound = '1';
      leaveBtn.addEventListener('click', logout);
    }
    function fileHint(msg) {
      var hint = $('spartan-channel-hint');
      if(hint) { hint.hidden = false; hint.textContent = msg; }
    }
    function uploadChatFile(file) {
      if(!file) return;
      if(file.size > 100 * 1024 * 1024) {
        fileHint('Arquivo passa de 100 MB.');
        return;
      }
      var c = cred();
      if(!c.user || !c.pass || !current.server || !current.channel) return;
      var fd = new FormData();
      fd.append('user', c.user);
      fd.append('password', c.pass);
      fd.append('server', current.server);
      fd.append('channel', current.channel);
      var cap = ($('spartan-text-input') && $('spartan-text-input').value) || '';
      if(cap) fd.append('text', cap);
      fd.append('file', file, file.name || 'arquivo');
      fetch(API + '/server-file', { method: 'POST', body: fd, credentials: 'omit', cache: 'no-store' })
        .then(function(r) {
          return r.json().then(function(j) {
            if(!r.ok) throw new Error((j && j.error) || 'Não enviou o arquivo.');
            return j;
          });
        })
        .then(function() {
          var input = $('spartan-text-input');
          if(input) input.value = '';
          loadText(true);
        })
        .catch(function(err) { fileHint(err.message || 'Não enviou o arquivo.'); });
    }
    var attach = $('spartan-text-attach');
    var fileInp = $('spartan-text-file');
    if(attach && fileInp && !attach.dataset.bound) {
      attach.dataset.bound = '1';
      attach.addEventListener('click', function() { fileInp.click(); });
      fileInp.addEventListener('change', function() {
        var f = fileInp.files && fileInp.files[0];
        fileInp.value = '';
        uploadChatFile(f);
      });
    }
    var textIn = $('spartan-text-input');
    if(textIn && !textIn.dataset.pasteBound) {
      textIn.dataset.pasteBound = '1';
      textIn.addEventListener('paste', function(ev) {
        var items = (ev.clipboardData && ev.clipboardData.items) || [];
        var i, it;
        for(i = 0; i < items.length; i++) {
          it = items[i];
          if(it.kind === 'file') {
            ev.preventDefault();
            uploadChatFile(it.getAsFile());
            return;
          }
        }
      });
    }
    var form = $('spartan-text-form');
    if(form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        var input = $('spartan-text-input');
        var text = (input && input.value || '').trim();
        if(!text) return;
        var c = cred();
        if(!c.user || !c.pass) return;
        apiPost('/server-text', {
          user: c.user, password: c.pass,
          server: current.server, channel: current.channel, text: text,
        }).then(function() {
          if(input) input.value = '';
          loadText(true);
        }).catch(function(err) {
          var hint = $('spartan-channel-hint');
          if(hint) { hint.hidden = false; hint.textContent = err.message || 'Não enviou.'; }
        });
      });
    }
  }

  function hideLeaveAsk() {
    var el = $('spartan-leave-ask');
    if(el) el.hidden = true;
  }

  function askLeave() {
    var el = $('spartan-leave-ask');
    if(!el) { doLogout(); return; }
    el.hidden = false;
  }

  function logout() { askLeave(); }

  function doLogout() {
    hideLeaveAsk();
    pingHere(true, current.voice, current.voiceServer);
    try {
      sessionStorage.removeItem('spartanAdmin');
      sessionStorage.removeItem('spartanPending');
      sessionStorage.removeItem('spartanSession');
      sessionStorage.removeItem('spartanGlobalCred');
      sessionStorage.setItem('spartanLoggedOut', '1');
      Object.keys(sessionStorage).forEach(function(k) {
        if(k.indexOf('spartanSession:') === 0 || k.indexOf('spartanGuestCred:') === 0)
          sessionStorage.removeItem(k);
      });
    } catch(e) {}
    var frame = $('spartan-room-frame');
    if(frame) {
      frame.hidden = true;
      frame.setAttribute('src', 'about:blank');
    }
    if(window.SpartanApp) window.SpartanApp.goHome();
    else location.hash = '#/';
  }

  window.SpartanServers = {
    handleInvite: handleInvite,
    activate: function(route) {
      document.documentElement.classList.add('spartan-people-collapsed');
      bindChrome();
      refreshList().then(function() {
        var first = (listCache[0] && listCache[0].id) || '';
        if(route && route.server) {
          if(!first) { if(window.SpartanApp) window.SpartanApp.goHome(); return; }
          if(inList(route.server) || !first) openServer(route.server, route.channel || 'geral', route.group);
          else openServer(first, 'geral');
        } else if(route && route.group) {
          var hit = findByGroup(route.group);
          if(hit) openServer(hit.server, hit.channel, route.group);
          else if(first) openServer(first, 'geral', route.group);
          else if(window.SpartanApp) window.SpartanApp.goHome();
        } else if(first) openServer(first, 'geral');
        else if(window.SpartanApp) window.SpartanApp.goHome();
      });
      startPoll();
    },
    deactivate: function() {
      stopPoll();
      pingHere(true);
      current = { server: null, channel: null, voice: null, voiceGroup: null, voiceTitle: '', voiceServer: null, voiceServerTitle: '' };
      mediaState = { nick: '', mic: false, share: false, cam: false };
      hideSwitchAsk();
      hideInviteAsk();
      var bar = $('spartan-user-bar');
      if(bar) bar.hidden = true;
    },
    goGroup: function(gid) {
      var hit = findByGroup(gid);
      if(hit && window.SpartanApp) {
        window.SpartanApp.goServer(hit.server, hit.channel);
        return true;
      }
      return false;
    },
  };
})();
