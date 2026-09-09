/* Spartan — qualidade da live (FPS, bitrate, HUD, bypass REMB da tela).
 * Funções globais de propósito: galene.js chama estas rotinas.
 * Carregar depois de /settings.js e /protocol.js, antes de /galene.js.
 */
'use strict';

/** FPS-alvo da tela (sempre 60 — não oscilar com o conteúdo). */
function spartanTargetShareFps() {
    return 60;
}

/** Restrições de captura de tela (FPS / resolução). */
function spartanShareVideoConstraints() {
    let sq = getSettings().shareQuality || 'auto';
    let fps = spartanTargetShareFps();
    /** @type {any} */
    let video = {
        cursor: 'always',
        // getDisplayMedia NÃO aceita min (Chrome: "min constraints are not supported").
        frameRate: { ideal: fps, max: fps },
    };
    if(sq === '720p') {
        video.width = { max: 1280, ideal: 1280 };
        video.height = { max: 720, ideal: 720 };
    } else if(sq === '1080p') {
        video.width = { max: 1920, ideal: 1920 };
        video.height = { max: 1080, ideal: 1080 };
    }
    return video;
}

/** Teto de bitrate para compartilhamento de tela (bps). */
function spartanScreenBitrateCap() {
    switch(getSettings().shareQuality || 'auto') {
    case '720p': return 5000000;
    case '1080p': return 10000000;
    // auto: teto alto — o limite real deixa de ser o REMB ~200 kbps do Galene.
    default: return 12000000;
    }
}

function spartanAvailableOutBps(stats) {
    let best = 0;
    for(let tid in stats) {
        let s = stats[tid] || {};
        let pair = s['candidate-pair'] || s['transport'] || null;
        if(pair && typeof pair.availableOutgoingBitrate === 'number')
            best = Math.max(best, pair.availableOutgoingBitrate);
        if(typeof s.availableOutgoingBitrate === 'number')
            best = Math.max(best, s.availableOutgoingBitrate);
    }
    return best;
}

function spartanAdaptShareFromStats(c, stats) {
    if(!c || !c.up || c.label !== 'screenshare')
        return;
    if(!c.userdata)
        c.userdata = {};
    let hard = spartanScreenBitrateCap();
    let m = spartanRtpStats(stats, 'up', String(c.localId) + ':adapt');
    let avail = spartanAvailableOutBps(stats);
    let now = Date.now();
    if(c.userdata._spartanAdaptAt && now - c.userdata._spartanAdaptAt < 8000)
        return;
    c.userdata._spartanAdaptAt = now;
    let cur = c.userdata._spartanAdaptBps || hard;
    let next = cur;
    let fpsWant = 60;
    if(avail > 0)
        next = Math.min(hard, Math.max(1200000, Math.round(avail * 0.85)));
    else if(m.fps > 0 && m.fps < 36 && m.kbps > 0)
        next = Math.max(1200000, Math.round(cur * 0.7));
    else if(m.fps >= 55 && cur < hard)
        next = Math.min(hard, Math.round(cur * 1.15));
    if(next < 2500000)
        fpsWant = 30;
    else if(next < 5000000)
        fpsWant = 45;
    c.userdata._spartanAdaptBps = next;
    c.userdata._spartanAdaptFps = fpsWant;
}

/** Teto efetivo da tela (bps), depois da escada automática. */
function spartanEffectiveShareBps(c) {
    if(c && c.userdata && c.userdata._spartanAdaptBps)
        return c.userdata._spartanAdaptBps;
    return spartanScreenBitrateCap();
}

/**
 * Galene manda goog-remb ~200 kbps se ninguém pediu vídeo alto (ou no ramp-up).
 * Na tela isso mata FPS/qualidade. Tiramos goog-remb do offer da screenshare
 * para o encoder respeitar o maxBitrate do cliente.
 * @param {string} sdp
 * @returns {string}
 */
function spartanStripRembSdp(sdp) {
    if(!sdp)
        return sdp;
    return String(sdp).replace(/a=rtcp-fb:[^\r\n]*goog-remb[^\r\n]*\r?\n/gi, '');
}

/** Instala bypass de REMB só em uplink de tela (uma vez). */
function spartanInstallShareRembBypass() {
    if(typeof Stream === 'undefined' || Stream.prototype._spartanShareRemb)
        return;
    Stream.prototype._spartanShareRemb = true;
    let orig = Stream.prototype.negotiate;
    Stream.prototype.negotiate = async function(restartIce) {
        if(!this.up || this.label !== 'screenshare')
            return await orig.call(this, restartIce);
        let c = this;
        /** @type {RTCOfferOptions} */
        let options = {};
        if(restartIce)
            options = {iceRestart: true};
        let offer = await c.pc.createOffer(options);
        if(!offer)
            throw new Error("Didn't create offer");
        let sdp = spartanStripRembSdp(offer.sdp);
        await c.pc.setLocalDescription({type: 'offer', sdp: sdp});
        c.sc.send({
            type: 'offer',
            source: c.sc.id,
            username: c.sc.username,
            kind: this.localDescriptionSent ? 'renegotiate' : '',
            id: c.id,
            replace: this.replace,
            label: c.label,
            sdp: c.pc.localDescription.sdp,
        });
        this.localDescriptionSent = true;
        this.replace = null;
        c.flushLocalIceCandidates();
        try {
            c.pc.getSenders().forEach(function(s) {
                spartanApplyVideoSenderPrefs(s, 'screenshare');
            });
        } catch(e) {}
    };
}

try { spartanInstallShareRembBypass(); } catch(e) {}

/**
 * Força FPS/bitrate no sender de vídeo (tela ou câmera).
 * @param {RTCRtpSender} sender
 * @param {string} label
 */
async function spartanApplyVideoSenderPrefs(sender, label) {
    if(!sender || !sender.track || sender.track.kind !== 'video')
        return;
    let c = (label === 'screenshare') ? findUpMedia('screenshare') : null;
    let fps = (c && c.userdata && c.userdata._spartanAdaptFps) || spartanTargetShareFps();
    let bps = getMaxVideoThroughput();
    if(label === 'screenshare')
        bps = spartanEffectiveShareBps(c);
    try {
        let p = sender.getParameters();
        if(!p.encodings || !p.encodings.length)
            p.encodings = [{}];
        p.encodings.forEach(function(e) {
            if(label === 'screenshare' || getSettings().gameMode !== false)
                e.maxFramerate = fps;
            if(bps)
                e.maxBitrate = bps;
            else
                e.maxBitrate = unlimitedRate;
            if(label === 'screenshare') {
                try { e.priority = 'high'; } catch(e1) {}
                try { e.networkPriority = 'high'; } catch(e2) {}
            }
        });
        if(label === 'screenshare' || getSettings().gameMode !== false)
            p.degradationPreference = 'maintain-framerate';
        else
            p.degradationPreference = 'maintain-resolution';
        await sender.setParameters(p);
    } catch(e) {}
}

/**
 * Aplica frameRate 60 na track de captura (pós getDisplayMedia).
 * @param {MediaStream} stream
 */
async function spartanLockShareTrackFps(stream) {
    if(!stream || !stream.getVideoTracks)
        return;
    let fps = spartanTargetShareFps();
    let tracks = stream.getVideoTracks();
    for(let i = 0; i < tracks.length; i++) {
        let t = tracks[i];
        try {
            await t.applyConstraints({ frameRate: { ideal: fps, max: fps } });
        } catch(e1) {
            try {
                await t.applyConstraints({ frameRate: fps });
            } catch(e2) {}
        }
        try { t.contentHint = getSettings().gameMode === false ? 'detail' : 'motion'; } catch(e3) {}
    }
}

/** @type {Record<string, {bytes: number, ts: number}>} */
let spartanRtpPrev = {};

function spartanRtpStats(stats, dir, streamKey) {
    let fps = 0, kbps = 0;
    for(let tid in stats) {
        let s = stats[tid];
        let rtp = s && (dir === 'up' ? s['outbound-rtp'] : s['inbound-rtp']);
        if(!rtp)
            continue;
        if(typeof rtp.framesPerSecond === 'number')
            fps = Math.max(fps, rtp.framesPerSecond);
        if(typeof rtp.rate === 'number' && rtp.rate > 0)
            kbps = Math.max(kbps, Math.round(rtp.rate / 1000));
        let bytes = typeof rtp.bytesSent === 'number' ? rtp.bytesSent
            : (typeof rtp.bytesReceived === 'number' ? rtp.bytesReceived : null);
        if(kbps <= 0 && bytes !== null && typeof rtp.timestamp === 'number') {
            let key = (streamKey || '') + ':' + tid + ':' + dir;
            let prev = spartanRtpPrev[key] || null;
            if(prev && rtp.timestamp > prev.ts) {
                let dt = (rtp.timestamp - prev.ts) / 1000;
                if(dt > 0)
                    kbps = Math.max(kbps, ((bytes - prev.bytes) * 8) / dt / 1000);
            }
            spartanRtpPrev[key] = {bytes: bytes, ts: rtp.timestamp};
        }
    }
    return {fps: Math.round(fps), kbps: Math.round(kbps)};
}

function spartanShouldShowHud(c, dir) {
    if(!c || dir !== 'up')
        return false;
    if(c.label !== 'screenshare' && c.label !== 'camera')
        return false;
    return getSettings().qualityHud !== false;
}

/** @type {Record<string, number>} */
let spartanHudFpsSmooth = {};

function spartanUpdateQualityHud(c, stats, dir) {
    if(!spartanShouldShowHud(c, dir))
        return;
    let peer = document.getElementById('peer-' + c.localId);
    if(!peer)
        return;
    let hud = document.getElementById('qhud-' + c.localId);
    if(!hud) {
        hud = document.createElement('div');
        hud.id = 'qhud-' + c.localId;
        hud.className = 'spartan-quality-hud';
        peer.appendChild(hud);
    }
    let m = spartanRtpStats(stats, dir, String(c.localId));
    let res = '';
    let capFps = 0;
    try {
        let vt = c.stream && c.stream.getVideoTracks && c.stream.getVideoTracks()[0];
        if(vt && vt.getSettings) {
            let s = vt.getSettings();
            if(s.width && s.height) res = s.width + '×' + s.height + ' · ';
            if(typeof s.frameRate === 'number' && s.frameRate > 0)
                capFps = Math.round(s.frameRate);
        }
    } catch(e) {}
    let key = String(c.localId);
    let prev = spartanHudFpsSmooth[key];
    if(prev == null || !isFinite(prev))
        prev = m.fps;
    // Suaviza o número do HUD (o outbound-rtp pula frame a frame).
    let smooth = Math.round(prev * 0.55 + (m.fps || 0) * 0.45);
    spartanHudFpsSmooth[key] = smooth;
    let adapt = (c.userdata && c.userdata._spartanAdaptBps) || 0;
    let capBps = (dir === 'up' && c.label === 'screenshare')
        ? (adapt || spartanScreenBitrateCap())
        : 0;
    let alvo = (dir === 'up' && c.label === 'screenshare')
        ? (c.userdata && c.userdata._spartanAdaptFps) || spartanTargetShareFps()
        : (capFps || smooth || '—');
    let br = '';
    if(dir === 'up' && c.label === 'screenshare') {
        let capKb = Math.round(capBps / 1000);
        br = (m.kbps || '—') + '/' + capKb + ' kbps';
    } else {
        br = (m.kbps || '—') + ' kbps';
    }
    hud.textContent = res + 'enviando · alvo ' + alvo + ' · ' + (smooth || '—') + ' fps · ' + br;
}
