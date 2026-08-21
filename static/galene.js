// Copyright (c) 2020 by Juliusz Chroboczek.

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

'use strict';

/**
 * The name of the group that we join.
 *
 * @type {string}
 */
let group;

/**
 * The connection to the server.
 *
 * @type {ServerConnection}
 */
let serverConnection;

/**
 * The group status.  This is set twice, once over HTTP in the start
 * function in order to obtain the WebSocket address, and a second time
 * after joining.
 *
 * @type {Record<string,any>}
 */
let groupStatus = {};

/**
 * True if we need to request a password.
 *
 * @type {boolean}
 */
let pwAuth = false;

/**
 * The token we use to login.  This is erased as soon as possible.
 *
 * @type {string}
 */
let token = null;

/**
 * The state of the login automaton.
 *
 * @type {"probing" | "need-username" | "success"}
 */
let probingState = null;

/**
 * getElementById, then assert that the result is an HTMLSelectElement.
 *
 * @param {string} id
 */
function getSelectElement(id) {
    let elt = document.getElementById(id);
    if(!elt || !(elt instanceof HTMLSelectElement))
        throw new Error(`Couldn't find ${id}`);
    return elt;
}

/**
 * getElementById, then assert that the result is an HTMLInputElement.
 *
 * @param {string} id
 */
function getInputElement(id) {
    let elt = document.getElementById(id);
    if(!elt || !(elt instanceof HTMLInputElement))
        throw new Error(`Couldn't find ${id}`);
    return elt;
}

/**
 * getElementById, then assert that the result is an HTMLButtonElement.
 *
 * @param {string} id
 */
function getButtonElement(id) {
    let elt = document.getElementById(id);
    if(!elt || !(elt instanceof HTMLButtonElement))
        throw new Error(`Couldn't find ${id}`);
    return elt;
}

/**
 * Ensure that the UI reflects the stored settings.
 */
function reflectSettings() {
    let settings = getSettings();
    let store = false;

    if(typeof settings.localMute !== 'boolean') {
        settings.localMute = true;
        store = true;
    }
    settings.localMute = true;
    setLocalMute(true, false);

    let videoselect = getSelectElement('videoselect');
    if(!settings.hasOwnProperty('video') ||
       !selectOptionAvailable(videoselect, settings.video)) {
        settings.video = selectOptionDefault(videoselect);
        store = true;
    }
    videoselect.value = settings.video;

    let audioselect = getSelectElement('audioselect');
    if(!settings.hasOwnProperty('audio') ||
       !selectOptionAvailable(audioselect, settings.audio)) {
        settings.audio = selectOptionDefault(audioselect);
        store = true;
    }
    audioselect.value = settings.audio;

    if(settings.hasOwnProperty('filter')) {
        getSelectElement('filterselect').value = settings.filter;
    } else {
        let s = getSelectElement('filterselect').value;
        if(s) {
            settings.filter = s;
            store = true;
        }
    }

    if(settings.hasOwnProperty('request')) {
        getSelectElement('requestselect').value = settings.request;
    } else {
        settings.request = getSelectElement('requestselect').value;
        store = true;
    }

    if(settings.hasOwnProperty('send')) {
        getSelectElement('sendselect').value = settings.send;
    } else {
        settings.send = getSelectElement('sendselect').value;
        store = true;
    }

    if(settings.hasOwnProperty('simulcast')) {
        getSelectElement('simulcastselect').value = settings.simulcast
    } else {
        settings.simulcast = getSelectElement('simulcastselect').value;
        store = true;
    }

    if(settings.hasOwnProperty('blackboardMode')) {
        getInputElement('blackboardbox').checked = settings.blackboardMode;
    } else {
        settings.blackboardMode = getInputElement('blackboardbox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('mirrorView')) {
        getInputElement('mirrorbox').checked = settings.mirrorView;
    } else {
        settings.mirrorView = getInputElement('mirrorbox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('activityDetection')) {
        getInputElement('activitybox').checked = settings.activityDetection;
    } else {
        settings.activityDetection = getInputElement('activitybox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('displayAll')) {
        getInputElement('displayallbox').checked = settings.displayAll;
    } else {
        settings.displayAll = false;
        getInputElement('displayallbox').checked = false;
        store = true;
    }

    if(settings.hasOwnProperty('hideSelf')) {
        getInputElement('hideselfbox').checked = settings.hideSelf;
    } else {
        settings.hideSelf = getInputElement('hideselfbox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('preprocessing')) {
        getInputElement('preprocessingbox').checked = settings.preprocessing;
    } else {
        settings.preprocessing = getInputElement('preprocessingbox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('hqaudio')) {
        getInputElement('hqaudiobox').checked = settings.hqaudio;
    } else {
        settings.hqaudio = getInputElement('hqaudiobox').checked;
        store = true;
    }

    if(store)
        storeSettings(settings);
}

/**
 * Returns true if we should use the mobile layout.  This should be kept
 * in sync with the CSS.
 */
function isMobileLayout() {
    return !!window.matchMedia('only screen and (max-width: 1024px)').matches
}

/**
 * Conditionally hide the video pane.  If force is true, hide it even if
 * there are videos.
 *
 * @param {boolean} [force]
 */
function hideVideo(force) {
    if(spartanVisibleCount() > 0 && !force)
        return;
    setVisibility('video-container', false);
    scheduleReconsiderDownRate();
}

/**
 * Show the video pane.
 */
function showVideo() {
    let hasmedia = spartanVisibleCount() > 0;
    if(isMobileLayout()) {
        setVisibility('show-video', false);
        setVisibility('collapse-video', hasmedia);
    }
    setVisibility('video-container', hasmedia);
    scheduleReconsiderDownRate();
}

/**
 * Returns true if we are running on Safari.
 */
function isSafari() {
    let ua = navigator.userAgent.toLowerCase();
    return ua.indexOf('safari') >= 0 && ua.indexOf('chrome') < 0;
}

/**
 * Returns true if we are running on Firefox.
 */
function isFirefox() {
    let ua = navigator.userAgent.toLowerCase();
    return ua.indexOf('firefox') >= 0;
}

const SPARTAN_GRID_MAX = 50;
/** @type {Record<string, boolean>} */
let spartanWatch = {};
/** @type {Record<string, boolean>} */
let spartanHasVideo = {};
/** @type {Record<string, boolean>} */
let spartanUserMuted = {};
let spartanHideOwn = false;
/** @type {Record<string, boolean>} ocultar cada live própria (por id) */
let spartanHideOwnStream = {};

/**
 * @param {MediaStream} [stream]
 * @returns {boolean}
 */
function streamHasRealVideo(stream) {
    if(!stream)
        return false;
    let tracks = stream.getVideoTracks();
    for(let i = 0; i < tracks.length; i++) {
        let t = tracks[i];
        if(t.readyState === 'ended' || !t.enabled)
            continue;
        try {
            let s = t.getSettings && t.getSettings();
            if(s && ((s.width === 0) || (s.height === 0)))
                continue;
        } catch(e) {}
        return true;
    }
    return false;
}

function spartanVisibleCount() {
    return document.querySelectorAll('#peers .peer:not(.peer-hidden)').length;
}

/**
 * @param {string} userId
 * @param {string} label
 * @returns {Stream|null}
 */
function spartanFindStream(userId, label) {
    if(!serverConnection)
        return null;
    let map = (userId === serverConnection.id) ?
        serverConnection.up : serverConnection.down;
    for(let id in map) {
        let c = map[id];
        if(c.label !== label)
            continue;
        if(userId === serverConnection.id || c.source === userId)
            return c;
    }
    return null;
}

/**
 * @param {Stream} c
 */
function spartanApplyUserMute(c) {
    if(!c || c.up || !c.stream)
        return;
    let muted = !!(c.source && spartanUserMuted[c.source]);
    c.stream.getAudioTracks().forEach(function(t) {
        t.enabled = !muted;
    });
}

/**
 * @param {Stream} c
 */
function spartanApplyDownRequest(c) {
    if(!c || c.up || typeof c.request !== 'function')
        return;
    if(spartanIsOuvinte()) {
        c.request(['audio']);
        return;
    }
    if(spartanWatch[c.id])
        c.request(['audio', 'video']);
    else
        // Mantém a stream viva (botões Tela 1/2…) sem baixar vídeo cheio.
        // audio-only costumava fechar screenshare sem áudio → sumiam os botões.
        c.request(['audio', 'video-low']);
}

function spartanIsOuvinte() {
    if(!serverConnection || !serverConnection.permissions) return false;
    let p = serverConnection.permissions;
    if(p.indexOf('op') >= 0 || p.indexOf('admin') >= 0) return false;
    // present sem message = Ouvinte no servidor; observe = sem poder falar
    if(p.indexOf('present') >= 0 && p.indexOf('message') < 0) return true;
    if(p.indexOf('present') < 0 && p.indexOf('message') < 0) return true;
    return false;
}

function spartanApplyOuvinteUi() {
    let on = spartanIsOuvinte();
    document.body.classList.toggle('spartan-ouvinte', on);
    if(on) {
        try { spartanSetChatOpen(false); } catch(e) {}
        try {
            for(let id in (serverConnection && serverConnection.down || {})) {
                delete spartanWatch[id];
                spartanApplyDownRequest(serverConnection.down[id]);
            }
        } catch(e) {}
        try { resizePeers(); } catch(e) {}
    }
}

/**
 * findByLocalId do protocol só olha up; aqui cobre up e down.
 * @param {string} localId
 * @returns {Stream|null}
 */
function spartanFindByLocalId(localId) {
    if(!serverConnection || !localId)
        return null;
    let c = serverConnection.findByLocalId(localId);
    if(c)
        return c;
    for(let id in serverConnection.down) {
        if(serverConnection.down[id].localId === localId)
            return serverConnection.down[id];
    }
    for(let id in serverConnection.up) {
        if(serverConnection.up[id].localId === localId)
            return serverConnection.up[id];
    }
    return null;
}

/**
 * Lives de um usuário (mesma ordem dos botões Tela/Câmera).
 * @param {string} userId
 * @returns {Stream[]}
 */
function spartanUserLives(userId) {
    if(!serverConnection || !userId)
        return [];
    let map = (userId === serverConnection.id) ?
        serverConnection.up : serverConnection.down;
    /** @type {Stream[]} */
    let lives = [];
    for(let id in map) {
        let c = map[id];
        if(userId !== serverConnection.id && c.source !== userId)
            continue;
        if(!spartanStreamShowsLiveBtn(c))
            continue;
        lives.push(c);
    }
    lives.sort(function(a, b) {
        if(a.label === b.label)
            return String(a.id).localeCompare(String(b.id));
        if(a.label === 'camera')
            return -1;
        if(b.label === 'camera')
            return 1;
        return String(a.label || '').localeCompare(String(b.label || ''));
    });
    return lives;
}

/**
 * Lives do mesmo tipo (tela/câmera) do mesmo usuário, ordenadas.
 * @param {Stream} c
 * @returns {Stream[]}
 */
function spartanSameKindLives(c) {
    if(!c || !serverConnection)
        return [];
    let userId = c.up ? serverConnection.id : c.source;
    let wantTela = c.label === 'screenshare';
    let lives = spartanUserLives(userId);
    /** @type {Stream[]} */
    let out = [];
    for(let i = 0; i < lives.length; i++) {
        if((lives[i].label === 'screenshare') === wantTela)
            out.push(lives[i]);
    }
    return out;
}

/**
 * @param {Stream} c
 * @returns {string}
 */
function spartanLiveKindCaption(c) {
    let list = spartanSameKindLives(c);
    let idx = 0;
    for(let i = 0; i < list.length; i++) {
        if(list[i].id === c.id) {
            idx = i + 1;
            break;
        }
    }
    let total = list.length;
    if(total < 1)
        total = 1;
    if(idx < 1)
        idx = 1;
    if(c.label === 'screenshare')
        return total <= 1 ? 'Tela' : ('Tela ' + idx);
    return total <= 1 ? 'Câmera' : ('Câmera ' + idx);
}

function spartanRefreshHideOwnButton() {
    let btn = document.getElementById('hideownbutton');
    if(!btn)
        return;
    let hasUpVideo = false;
    if(serverConnection) {
        for(let id in serverConnection.up) {
            if(streamHasRealVideo(serverConnection.up[id].stream) ||
               serverConnection.up[id].label === 'screenshare') {
                hasUpVideo = true;
                break;
            }
        }
    }
    if(hasUpVideo)
        btn.classList.remove('invisible');
    else
        btn.classList.add('invisible');
    let icon = btn.querySelector('.fas');
    let lab = btn.querySelector('label');
    if(spartanHideOwn) {
        btn.classList.add('hiding');
        if(icon) {
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        }
        if(lab)
            lab.textContent = 'Mostrar o meu';
    } else {
        btn.classList.remove('hiding');
        if(icon) {
            icon.classList.add('fa-eye');
            icon.classList.remove('fa-eye-slash');
        }
        if(lab)
            lab.textContent = 'Ocultar o meu';
    }
}

function spartanRefreshAllMedia() {
    if(!serverConnection)
        return;
    function walk(map) {
        for(let id in map) {
            let c = map[id];
            let elt = document.getElementById('peer-' + c.localId);
            if(elt)
                showHideMedia(c, elt);
            setLabel(c);
            spartanApplyUserMute(c);
        }
    }
    walk(serverConnection.down);
    walk(serverConnection.up);
    spartanRefreshHideOwnButton();
    if(serverConnection.users) {
        for(let uid in serverConnection.users) {
            let row = document.getElementById('user-' + uid);
            if(row)
                spartanFillUserLives(uid, row);
        }
    }
    resizePeers();
    showVideo();
}

/**
 * @param {Stream} c
 * @returns {boolean}
 */
function spartanStreamShowsLiveBtn(c) {
    if(!c)
        return false;
    if(spartanHasVideo[c.id])
        return true;
    if(c.label === 'screenshare')
        return true;
    return streamHasRealVideo(c.stream);
}

/**
 * @param {string} userId
 * @param {HTMLElement} elt
 */
function spartanFillUserLives(userId, elt) {
    let box = elt.querySelector('.user-lives');
    if(!box)
        return;
    box.textContent = '';
    if(!serverConnection)
        return;
    if(spartanIsOuvinte())
        return;
    let lives = spartanUserLives(userId);
    let telaTotal = 0;
    let camTotal = 0;
    for(let i = 0; i < lives.length; i++) {
        if(lives[i].label === 'screenshare')
            telaTotal++;
        else
            camTotal++;
    }
    let telaIdx = 0;
    let camIdx = 0;
    for(let i = 0; i < lives.length; i++) {
        let c = lives[i];
        let b = document.createElement('button');
        b.type = 'button';
        b.className = 'user-live-btn';
        if(c.label === 'screenshare') {
            telaIdx++;
            b.textContent = telaTotal <= 1 ? 'Tela' : ('Tela ' + telaIdx);
        } else {
            camIdx++;
            b.textContent = camTotal <= 1 ? 'Câmera' : ('Câmera ' + camIdx);
        }
        if(c.up) {
            if(!spartanHideOwn && !spartanHideOwnStream[c.id])
                b.classList.add('on');
        } else if(spartanWatch[c.id]) {
            b.classList.add('on');
        }
        b.addEventListener('click', (function(stream) {
            return function(e) {
                e.preventDefault();
                e.stopPropagation();
                spartanToggleLive(stream);
            };
        })(c));
        box.appendChild(b);
    }
    let muteBtn = elt.querySelector('.user-mute-btn');
    if(muteBtn) {
        if(spartanUserMuted[userId])
            muteBtn.classList.add('on');
        else
            muteBtn.classList.remove('on');
    }
}

/**
 * @param {Stream} c
 */
function spartanToggleLive(c) {
    if(!c)
        return;
    if(c.up) {
        spartanHideOwnStream[c.id] = !spartanHideOwnStream[c.id];
        spartanRefreshAllMedia();
        return;
    }
    if(spartanIsOuvinte())
        return;
    if(spartanWatch[c.id]) {
        delete spartanWatch[c.id];
        spartanApplyDownRequest(c);
        let div = document.getElementById('peer-' + c.localId);
        if(div) {
            div.classList.remove('peer-focus');
            div.classList.remove('peer-fs');
        }
        document.body.classList.remove('spartan-peer-fs');
        let vc = document.getElementById('video-container');
        if(vc)
            vc.classList.remove('peer-focus-mode');
        spartanRefreshAllMedia();
        return;
    }
    if(spartanVisibleCount() >= SPARTAN_GRID_MAX) {
        displayMessage('Limite de 50 lives nesta tela.');
        return;
    }
    spartanWatch[c.id] = true;
    spartanApplyDownRequest(c);
    spartanRefreshAllMedia();
}

/**
 * @param {string} userId
 */
function spartanToggleUserMute(userId) {
    spartanUserMuted[userId] = !spartanUserMuted[userId];
    if(serverConnection) {
        for(let id in serverConnection.down) {
            let c = serverConnection.down[id];
            if(c.source === userId)
                spartanApplyUserMute(c);
        }
    }
    let row = document.getElementById('user-' + userId);
    if(row)
        spartanFillUserLives(userId, row);
}

function spartanSetChatOpen(open) {
    if(open && spartanIsOuvinte())
        open = false;
    let chat = document.getElementById('chat');
    let btn = document.getElementById('channel-chat-btn');
    if(!chat)
        return;
    if(open) {
        chat.hidden = false;
        chat.classList.add('spartan-chat-open');
        if(btn)
            btn.classList.add('on');
    } else {
        chat.hidden = true;
        chat.classList.remove('spartan-chat-open');
        if(btn)
            btn.classList.remove('on');
    }
}

function openNav() {
    document.getElementById('sidebarnav').classList.add('spartan-settings-open');
    document.body.classList.add('spartan-settings-on');
}

function closeNav() {
    document.getElementById('sidebarnav').classList.remove('spartan-settings-open');
    document.body.classList.remove('spartan-settings-on');
}

/**
 * setConnected is called whenever we connect or disconnect to the server.
 *
 * @param{boolean} connected
 */
function setConnected(connected) {
    document.body.classList.toggle('spartan-in', !!connected);
    document.documentElement.classList.toggle('spartan-rejoin', !!connected);
    let userbox = document.getElementById('profile');
    let connectionbox = document.getElementById('login-container');
    if(connected) {
        clearChat();
        userbox.classList.remove('invisible');
        connectionbox.classList.add('invisible');
        displayUsername();
        window.onresize = function(e) {
            scheduleReconsiderDownRate();
        }
    } else {
        userbox.classList.add('invisible');
        connectionbox.classList.remove('invisible');
        hideVideo();
        window.onresize = null;
    }
}

/**
 * Called when we connect to the server.
 *
 * @this {ServerConnection}
 */
async function gotConnected() {
    setConnected(true);
    await join();
}

/**
 * Sets the href field of the "change password" link.
 *
 * @param {string} username
 */

function setAdminPanel(forceOff) {
 let s = document.getElementById('adminspan');
 if(!s) return;
 if(forceOff) { s.classList.add('invisible'); return; }
 let p = serverConnection && serverConnection.permissions;
 let ok = p && (p.indexOf('op') >= 0 || p.indexOf('admin') >= 0);
 if(ok) {
  s.classList.remove('invisible');
  try{
   let pend=JSON.parse(sessionStorage.getItem('spartanSession:'+group)||'null');
   if(pend&&pend.user&&pend.pass){
    let hand={user:String(pend.user).trim().toLowerCase(),pass:pend.pass};
    sessionStorage.setItem('spartanAdmin',JSON.stringify(hand));
    // Nova aba não herda sessionStorage — localStorage faz o handoff.
    localStorage.setItem('spartanAdminHandoff',JSON.stringify(hand));
   }
  }catch(e){}
 } else s.classList.add('invisible');
}

function setChangePassword(username) {
    let s = document.getElementById('chpwspan');
    let a = s.children[0];
    if(!(a instanceof HTMLAnchorElement))
        throw new Error('Bad type for chpwspan');
    if(username) {
        a.href = `/change-password.html?group=${encodeURIComponent(group)}&username=${encodeURIComponent(username)}`;
        a.target = '_blank';
        s.classList.remove('invisible');
    } else {
        a.href = null;
        s.classList.add('invisible');
    }
}

/**
 * Join a group.
 */
async function join() {
    let username = getInputElement('username').value.trim().toLowerCase();
    getInputElement('username').value = username;
    let credentials;
    if(token) {
        pwAuth = false;
        credentials = {
            type: 'token',
            token: token,
        };
        switch(probingState) {
        case null:
            // when logging in with a token, we need to give the user
            // a chance to interact with the page in order to enable
            // autoplay.  Probe the group first in order to determine if
            // we need a username.  We should really extend the protocol
            // to have a simpler protocol for probing.
            probingState = 'probing';
            username = null;
            break;
        case 'need-username':
        case 'success':
            probingState = null;
            break
        default:
            console.warn(`Unexpected probing state ${probingState}`);
            probingState = null;
            break;
        }
    } else {
        if(probingState !== null) {
            console.warn(`Unexpected probing state ${probingState}`);
            probingState = null;
        }
        let pw = getInputElement('password').value || window._spartanCred || ''; window._spartanCred='';
        try{var _s=JSON.stringify({user:username,pass:pw,group:group}); sessionStorage.removeItem('spartanLoggedOut'); sessionStorage.setItem('spartanSession:'+group,_s); sessionStorage.removeItem('spartanSession'); sessionStorage.removeItem('spartanPending');
            if(pw){ var _h={user:username,pass:pw}; sessionStorage.setItem('spartanAdmin',JSON.stringify(_h)); localStorage.setItem('spartanAdminHandoff',JSON.stringify(_h)); }
        }catch(e){}
        getInputElement('password').value = '';
        if(!groupStatus.authServer) {
            pwAuth = true;
            credentials = pw;
        } else {
            pwAuth = false;
            credentials = {
                type: 'authServer',
                authServer: groupStatus.authServer,
                location: location.href,
                password: pw,
            };
        }
    }

    try {
        await serverConnection.join(group, username, credentials);
    } catch(e) {
        console.error(e);
        displayError(e);
        serverConnection.close();
    }
}

/**
 * @this {ServerConnection}
 */
function onPeerConnection() {
    if(!getSettings().forceRelay)
        return null;
    let old = this.rtcConfiguration;
    /** @type {RTCConfiguration} */
    let conf = {};
    for(let key in old)
        conf[key] = old[key];
    conf.iceTransportPolicy = 'relay';
    return conf;
}

/**
 * @this {ServerConnection}
 * @param {number} code
 * @param {string} reason
 */
function gotClose(code, reason) {
    closeUpMedia();
    closeSafariStream();
    setConnected(false);
    if(code !== 1000) {
        console.warn('Socket close', code, reason);
    }
    let form = document.getElementById('loginform');
    if(!(form instanceof HTMLFormElement))
        throw new Error('Bad type for loginform');
}

/**
 * @this {ServerConnection}
 * @param {Stream} c
 */
function gotDownStream(c) {
    c.onclose = function(replace) {
        delete spartanWatch[c.id];
        delete spartanHasVideo[c.id];
        delete spartanHideOwnStream[c.id];
        if(!replace)
            delMedia(c.localId);
        if(c.source)
            spartanRefreshAllMedia();
    };
    c.onerror = function(e) {
        console.error(e);
        displayError(e);
    };
    c.ondowntrack = function(track, transceiver, stream) {
        spartanApplyUserMute(c);
        if(c.label === 'screenshare')
            spartanHasVideo[c.id] = true;
        if(track && track.kind === 'video' && streamHasRealVideo(c.stream))
            spartanHasVideo[c.id] = true;
        setMedia(c);
        // Não rebaixa para audio-only aqui — isso fechava screenshare e sumia o botão.
        if(c.source)
            spartanRefreshAllMedia();
    };
    c.onnegotiationcompleted = function() {
        resetMedia(c);
    }
    c.onstatus = function(status) {
        setMediaStatus(c);
    };
    c.onstats = gotDownStats;
    c.setStatsInterval(activityDetectionInterval);

    if(c.label === 'screenshare')
        spartanHasVideo[c.id] = true;
    setMedia(c);
    if(!spartanWatch[c.id])
        spartanApplyDownRequest(c);
}

// Store current browser viewport height in css variable
function setViewportHeight() {
    document.documentElement.style.setProperty(
        '--vh', `${window.innerHeight/100}px`,
    );
    if (!getVisibility('left')) {
        showVideo();
    }
    // Ajust video component size
    resizePeers();
}

// On resize and orientation change, we update viewport height
addEventListener('resize', setViewportHeight);
addEventListener('orientationchange', setViewportHeight);

getButtonElement('presentbutton').onclick = async function(e) {
    e.preventDefault();
    let button = this;
    if(!(button instanceof HTMLButtonElement))
        throw new Error('Unexpected type for this.');
    // there's a potential race condition here: the user might click the
    // button a second time before the stream is set up and the button hidden.
    button.disabled = true;
    try {
        let id = findUpMedia('camera');
        if(!id)
            await addLocalMedia();
    } finally {
        button.disabled = false;
    }
};

getButtonElement('unpresentbutton').onclick = function(e) {
    e.preventDefault();
    closeUpMedia('camera');
    resizePeers();
};

/**
 * @param {string} id
 * @param {boolean} visible
 */
function setVisibility(id, visible) {
    let elt = document.getElementById(id);
    if(visible)
        elt.classList.remove('invisible');
    else
        elt.classList.add('invisible');
}

/**
 * getVisibility tells whether specified element is visible.
 *
 * @param {string} id
 */
function getVisibility(id) {
    let elt = document.getElementById(id);
    return !elt.classList.contains('invisible');
}

/**
 * Shows and hides various UI elements depending on the protocol state.
 */
function setButtonsVisibility() {
    let connected = serverConnection && serverConnection.socket;
    let permissions = serverConnection.permissions;
    let ouvinte = spartanIsOuvinte();
    let canWebrtc = !(typeof RTCPeerConnection === 'undefined');
    let canPresent = !ouvinte && canWebrtc &&
        ('mediaDevices' in navigator) &&
        ('getUserMedia' in navigator.mediaDevices) &&
        permissions.indexOf('present') >= 0;
    let canShare = !ouvinte && canWebrtc &&
        ('mediaDevices' in navigator) &&
        ('getDisplayMedia' in navigator.mediaDevices) &&
        permissions.indexOf('present') >= 0;
    let canVoice = canWebrtc &&
        ('mediaDevices' in navigator) &&
        ('getUserMedia' in navigator.mediaDevices) &&
        permissions.indexOf('present') >= 0;
    let local = !!findUpMedia('camera');
    let mediacount = document.getElementById('peers').childElementCount;
    let mobilelayout = isMobileLayout();

    setVisibility('presentbutton', false);
    setVisibility('unpresentbutton', false);
    setVisibility('camerabutton', canPresent);

    setVisibility('mutebutton', !connected || canVoice);
    let camBtn = document.getElementById('camerabutton');
    if(camBtn) {
        let cam = findUpMedia('camera');
        let camOn = !!(cam && cam.stream && cam.stream.getVideoTracks().length);
        if(camOn)
            camBtn.classList.add('cam-on');
        else
            camBtn.classList.remove('cam-on');
    }

    // allow multiple shared documents
    setVisibility('sharebutton', canShare);
 let shareBtn = document.getElementById('sharebutton');
 if(shareBtn) {
 if(findUpMedia('screenshare'))
 shareBtn.classList.add('sharing');
 else
 shareBtn.classList.remove('sharing');
 }
    spartanRefreshHideOwnButton();

    setVisibility('mediaoptions', canPresent);
    setVisibility('sendform', canPresent && permissions.indexOf('message') >= 0);
    setVisibility('simulcastform', canPresent);

    setVisibility('collapse-video', !ouvinte && mediacount && mobilelayout);
    let chatBtn = document.getElementById('channel-chat-btn');
    if(chatBtn) setVisibility('channel-chat-btn', connected && !ouvinte);
    spartanApplyOuvinteUi();
}

/**
 * Sets the local mute state.  If reflect is true, updates the stored settings.
 *
 * @param {boolean} mute
 * @param {boolean} [reflect]
 */
function setLocalMute(mute, reflect) {
    muteLocalTracks(mute);
    let button = document.getElementById('mutebutton');
    let icon = button.querySelector("span .fas");
    let live = !!findUpMedia('camera') && !mute;
    if(!live){
        icon.classList.add('fa-microphone-slash');
        icon.classList.remove('fa-microphone');
        button.classList.add('muted');
    } else {
        icon.classList.remove('fa-microphone-slash');
        icon.classList.add('fa-microphone');
        button.classList.remove('muted');
    }
    if(reflect)
        updateSettings({localMute: mute});
    if(mute && serverConnection)
        spartanSetUserTalking(serverConnection.id, false);
}

getSelectElement('videoselect').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({video: this.value});
    replaceCameraStream();
};

getSelectElement('audioselect').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({audio: this.value});
    replaceCameraStream();
};

getInputElement('mirrorbox').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({mirrorView: this.checked});
    // no need to reopen the camera
    replaceUpStreams('camera');
};

getInputElement('blackboardbox').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({blackboardMode: this.checked});
    replaceCameraStream();
};

getInputElement('preprocessingbox').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({preprocessing: this.checked});
    replaceCameraStream();
};

getInputElement('hqaudiobox').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({hqaudio: this.checked});
    replaceCameraStream();
};

document.getElementById('mutebutton').onclick = async function(e) {
    e.preventDefault();
    if(!findUpMedia('camera')) {
        try {
            await addLocalMedia(undefined, true);
            setLocalMute(false, true);
        } catch(err) {
            console.error(err);
            displayError(err);
        }
        return;
    }
    setLocalMute(!getSettings().localMute, true);
};

document.getElementById('camerabutton').onclick = async function(e) {
    e.preventDefault();
    if(spartanIsOuvinte()) {
        displayWarning('Ouvinte não transmite vídeo.');
        return;
    }
    let cam = findUpMedia('camera');
    try {
        if(!cam)
            await addLocalMedia();
        else if(!cam.stream || cam.stream.getVideoTracks().length === 0)
            replaceCameraStream();
    } catch(err) {
        console.error(err);
        displayError(err);
    }
};

document.getElementById('sharebutton').onclick = function(e) {
    e.preventDefault();
    if(spartanIsOuvinte()) {
        displayWarning('Ouvinte não transmite tela.');
        return;
    }
    addShareMedia();
};

getSelectElement('filterselect').onchange = async function(e) {
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({filter: this.value});
    let c = findUpMedia('camera');
    if(c) {
        let filter = (this.value && filters[this.value]) || null;
        if(filter)
            c.userdata.filterDefinition = filter;
        else
            delete c.userdata.filterDefinition;
        replaceUpStream(c);
    }
};

/**
 * Returns the desired max video throughput depending on the settings.
 *
 * @returns {number}
 */
function getMaxVideoThroughput() {
    let v = getSettings().send;
    switch(v) {
    case 'lowest':
        return 150000;
    case 'low':
        return 300000;
    case 'normal':
        return 700000;
    case 'unlimited':
        return null;
    default:
        console.error('Unknown video quality', v);
        return 700000;
    }
}

getSelectElement('sendselect').onchange = async function(e) {
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({send: this.value});
    await reconsiderSendParameters();
};

getSelectElement('simulcastselect').onchange = async function(e) {
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({simulcast: this.value});
    await reconsiderSendParameters();
};

/**
 * Maps the state of the receive UI element to a protocol request.
 *
 * @param {string} what
 * @returns {Record<string,Array<string>>}
 */

function mapRequest(what) {
    switch(what) {
    case '':
        return {'': []};
    case 'audio':
        return {'': ['audio']};
    case 'screenshare':
        return {screenshare: ['audio','video'], '': ['audio']};
    case 'everything-low':
        return {'': ['audio','video-low']};
    case 'everything':
        return {'': ['audio','video']}
    default:
        throw new Error(`Unknown value ${what} in request`);
    }
}

/**
 * Like mapRequest, but for a single label.
 *
 * @param {string} what
 * @param {string} label
 * @returns {Array<string>}
 */

function mapRequestLabel(what, label) {
    let r = mapRequest(what);
    if(label in r)
        return r[label];
    else
        return r[''];
}


getSelectElement('requestselect').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({request: this.value});
    serverConnection.request(mapRequest(this.value));
    if(serverConnection && serverConnection.down) {
        for(let id in serverConnection.down)
            spartanApplyDownRequest(serverConnection.down[id]);
    }
    reconsiderDownRate();
};

const activityDetectionInterval = 200;
const activityDetectionPeriod = 700;
const activityDetectionThreshold = 0.2;

getInputElement('activitybox').onchange = function(e) {
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({activityDetection: this.checked});
    for(let id in serverConnection.down) {
        let c = serverConnection.down[id];
        if(this.checked)
            c.setStatsInterval(activityDetectionInterval);
        else {
            setActive(c, false);
        }
    }
};

function refreshAllMediaVisibility() {
    if(!serverConnection)
        return;
    function refresh(map) {
        for(let id in map) {
            let c = map[id];
            let elt = document.getElementById('peer-' + c.localId);
            if(elt)
                showHideMedia(c, elt);
        }
    }
    refresh(serverConnection.down);
    refresh(serverConnection.up);
    resizePeers();
}

getInputElement('displayallbox').onchange = function(e) {
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({displayAll: this.checked});
    refreshAllMediaVisibility();
};

getInputElement('hideselfbox').onchange = function(e) {
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({hideSelf: this.checked});
    refreshAllMediaVisibility();
};


/**
 * @this {Stream}
 * @param {Record<string,any>} stats
 */
function gotUpStats(stats) {
    // Spartan: não mostra bitrate no tile; o rótulo é "Minha Live" / nome.
    setLabel(this);
}

/**
 * @param {Stream} c
 * @param {boolean} value
 */
function setActive(c, value) {
    let peer = document.getElementById('peer-' + c.localId);
    if(!peer)
        return;
    if(value)
        peer.classList.add('peer-active');
    else
        peer.classList.remove('peer-active');
}

/**
 * @param {string} userId
 * @param {boolean} on
 */
function spartanSetUserTalking(userId, on) {
    let elt = document.getElementById('user-' + userId);
    if(!elt)
        return;
    if(on)
        elt.classList.add('user-talking');
    else
        elt.classList.remove('user-talking');
}

let spartanTalkCtx = null;
let spartanTalkAnalyser = null;
let spartanTalkSource = null;
let spartanTalkTimer = null;

/**
 * @param {MediaStream} [stream]
 */
function spartanHookLocalTalk(stream) {
    try {
        if(spartanTalkSource) {
            try { spartanTalkSource.disconnect(); } catch(e) {}
            spartanTalkSource = null;
        }
        if(!stream || !stream.getAudioTracks().length)
            return;
        let AC = window.AudioContext || window.webkitAudioContext;
        if(!AC)
            return;
        if(!spartanTalkCtx)
            spartanTalkCtx = new AC();
        if(spartanTalkCtx.state === 'suspended')
            spartanTalkCtx.resume();
        spartanTalkAnalyser = spartanTalkCtx.createAnalyser();
        spartanTalkAnalyser.fftSize = 512;
        spartanTalkSource = spartanTalkCtx.createMediaStreamSource(stream);
        spartanTalkSource.connect(spartanTalkAnalyser);
        if(!spartanTalkTimer)
            spartanTalkTimer = setInterval(spartanTickLocalTalk, 200);
    } catch(e) {}
}

function spartanTickLocalTalk() {
    if(!serverConnection)
        return;
    let on = false;
    let c = findUpMedia('camera');
    if(c && c.stream && !getSettings().localMute && spartanTalkAnalyser) {
        let live = c.stream.getAudioTracks().some(function(t) {
            return t.enabled && t.readyState === 'live';
        });
        if(live) {
            let data = new Uint8Array(spartanTalkAnalyser.fftSize);
            spartanTalkAnalyser.getByteTimeDomainData(data);
            let sum = 0;
            for(let i = 0; i < data.length; i++) {
                let v = (data[i] - 128) / 128;
                sum += v * v;
            }
            on = Math.sqrt(sum / data.length) > 0.045;
        }
    }
    spartanSetUserTalking(serverConnection.id, on);
}

/**
 * @this {Stream}
 * @param {Record<string,any>} stats
 */
function gotDownStats(stats) {
    let c = this;

    let maxEnergy = 0;

    c.pc.getReceivers().forEach(r => {
        let tid = r.track && r.track.id;
        let s = tid && stats[tid];
        let energy = s && s['inbound-rtp'] && s['inbound-rtp'].audioEnergy;
        if(typeof energy === 'number')
            maxEnergy = Math.max(maxEnergy, energy);
    });

    let talking = maxEnergy > activityDetectionThreshold * activityDetectionThreshold;
    if(talking)
        c.userdata.lastVoiceActivity = Date.now();
    let still = talking;
    if(!still) {
        let last = c.userdata.lastVoiceActivity;
        still = !!(last && Date.now() - last <= activityDetectionPeriod);
    }
    if(c.label === 'camera' || !c.label)
        spartanSetUserTalking(c.source, still);

    if(!getInputElement('activitybox').checked)
        return;

    if(talking)
        setActive(c, true);
    else if(!still)
        setActive(c, false);
}

/**
 * Add an option to an HTMLSelectElement.
 *
 * @param {HTMLSelectElement} select
 * @param {string} label
 * @param {string} [value]
 */
function addSelectOption(select, label, value) {
    if(!value)
        value = label;
    for(let i = 0; i < select.children.length; i++) {
        let child = select.children[i];
        if(!(child instanceof HTMLOptionElement)) {
            console.warn('Unexpected select child');
            continue;
        }
        if(child.value === value) {
            if(child.label !== label) {
                child.label = label;
            }
            return;
        }
    }

    let option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
}

/**
 * Returns true if an HTMLSelectElement has an option with a given value.
 *
 * @param {HTMLSelectElement} select
 * @param {string} value
 */
function selectOptionAvailable(select, value) {
    let children = select.children;
    for(let i = 0; i < children.length; i++) {
        let child = select.children[i];
        if(!(child instanceof HTMLOptionElement)) {
            console.warn('Unexpected select child');
            continue;
        }
        if(child.value === value)
            return true;
    }
    return false;
}

/**
 * @param {HTMLSelectElement} select
 * @returns {string}
 */
function selectOptionDefault(select) {
    /* First non-empty option. */
    for(let i = 0; i < select.children.length; i++) {
        let child = select.children[i];
        if(!(child instanceof HTMLOptionElement)) {
            console.warn('Unexpected select child');
            continue;
        }
        if(child.value)
            return child.value;
    }
    /* The empty option is always available. */
    return '';
}

/**
  * True if we already went through setMediaChoices twice.
  *
  * @type {boolean}
  */
let mediaChoicesDone = false;

/**
 * Populate the media choices menu.
 *
 * Since media names might not be available before we call
 * getDisplayMedia, we call this function twice, the second time in order
 * to update the menu with user-readable labels.
 *
 * @param{boolean} done
 */
async function setMediaChoices(done) {
    if(mediaChoicesDone)
        return;

    let devices = [];
    try {
        if('mediaDevices' in navigator)
            devices = await navigator.mediaDevices.enumerateDevices();
    } catch(e) {
        console.error(e);
        return;
    }

    let cn = 1, mn = 1;

    devices.forEach(d => {
        let label = d.label;
        if(d.kind === 'videoinput') {
            if(!label)
                label = `Câmera ${cn}`;
            addSelectOption(getSelectElement('videoselect'),
                            label, d.deviceId);
            cn++;
        } else if(d.kind === 'audioinput') {
            if(!label)
                label = `Microfone ${mn}`;
            addSelectOption(getSelectElement('audioselect'),
                            label, d.deviceId);
            mn++;
        }
    });

    mediaChoicesDone = done;
}


/**
 * @param {string} [localId]
 */
function newUpStream(localId) {
    if(!serverConnection)
        throw new Error("Sem conexão");
    let c = serverConnection.newUpStream(localId);
    c.onstatus = function(status) {
        setMediaStatus(c);
    };
    c.onerror = function(e) {
        console.error(e);
        displayError(e);
    };
    return c;
}

/**
 * Sets an up stream's video throughput and simulcast parameters.
 *
 * @param {Stream} c
 * @param {number} bps
 * @param {boolean} simulcast
 */
async function setSendParameters(c, bps, simulcast) {
    if(!c.up)
        throw new Error('Setting throughput of down stream');
    if(c.label === 'screenshare')
        simulcast = false;
    let senders = c.pc.getSenders();
    for(let i = 0; i < senders.length; i++) {
        let s = senders[i];
        if(!s.track || s.track.kind !== 'video')
            continue;
        let p = s.getParameters();
        if((!p.encodings ||
            !simulcast && p.encodings.length !== 1) ||
           (simulcast && p.encodings.length !== 2)) {
            await replaceUpStream(c);
            return;
        }
        p.encodings.forEach(e => {
            if(!e.rid || e.rid === 'h')
                e.maxBitrate = bps || unlimitedRate;
        });
        await s.setParameters(p);
    }
}

let reconsiderParametersTimer = null;

/**
 * Sets the send parameters for all up streams.
 */
async function reconsiderSendParameters() {
    cancelReconsiderParameters();
    let t = getMaxVideoThroughput();
    let s = doSimulcast();
    let promises = [];
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        promises.push(setSendParameters(c, t, s));
    }
    await Promise.all(promises);
}

/**
 * Schedules a call to reconsiderSendParameters after a delay.
 * The delay avoids excessive flapping.
 */
function scheduleReconsiderParameters() {
    cancelReconsiderParameters();
    reconsiderParametersTimer =
        setTimeout(reconsiderSendParameters, 10000 + Math.random() * 10000);
}

function cancelReconsiderParameters() {
    if(reconsiderParametersTimer) {
        clearTimeout(reconsiderParametersTimer);
        reconsiderParametersTimer = null;
    }
}

const unlimitedRate = 1000000000;
const simulcastRate = 100000;
const hqAudioRate = 128000;

/**
 * Decide whether we want to send simulcast.
 *
 * @returns {boolean}
 */
function doSimulcast() {
    switch(getSettings().simulcast) {
    case 'on':
        return true;
    case 'off':
        return false;
    default:
        let count = 0;
        for(let n in serverConnection.users) {
            if(!serverConnection.users[n].permissions["system"]) {
                count++;
                if(count > 2)
                    break;
            }
        }
        if(count <= 2)
            return false;
        let bps = getMaxVideoThroughput();
        return bps <= 0 || bps >= 2 * simulcastRate;
    }
}

/**
 * Sets up c to send the given stream.  Some extra parameters are stored
 * in c.userdata.
 *
 * @param {Stream} c
 * @param {MediaStream} stream
 */

async function setUpStream(c, stream) {
    if(c.stream !== null)
        throw new Error("Setting nonempty stream");

    c.setStream(stream);

    // set up the handler early, in case setFilter fails.
    c.onclose = async replace => {
        await removeFilter(c);
        if(!replace) {
            stopStream(c.stream);
            if(c.userdata.onclose)
                c.userdata.onclose.call(c);
            delMedia(c.localId);
        }
    }

    await setFilter(c);

    /**
     * @param {MediaStreamTrack} t
     */
    function addUpTrack(t) {
        let settings = getSettings();
        if(c.label === 'camera') {
            if(t.kind === 'audio') {
                if(settings.localMute)
                    t.enabled = false;
            } else if(t.kind === 'video') {
                if(settings.blackboardMode) {
                    t.contentHint = 'detail';
                }
            }
        }
        t.onended = e => {
            stream.onaddtrack = null;
            stream.onremovetrack = null;
            c.close();
        };

        let encodings = [];
        let simulcast = c.label !== 'screenshare' && doSimulcast();
        if(t.kind === 'video') {
            let bps = getMaxVideoThroughput();
            // Firefox doesn't like us setting the RID if we're not
            // simulcasting.
            if(simulcast) {
                encodings.push({
                    rid: 'h',
                    maxBitrate: bps || unlimitedRate,
                });
                encodings.push({
                    rid: 'l',
                    scaleResolutionDownBy: 2,
                    maxBitrate: simulcastRate,
                });
            } else {
                encodings.push({
                    maxBitrate: bps || unlimitedRate,
                });
            }
        } else {
            if(settings.hqaudio) {
                encodings.push({
                    maxBitrate: hqAudioRate,
                });
            }
        }
        let tr = c.pc.addTransceiver(t, {
            direction: 'sendonly',
            streams: [stream],
            sendEncodings: encodings,
        });

        // Firefox before 110 does not implement sendEncodings, and
        // requires this hack, which throws an exception on Chromium.
        try {
            let p = tr.sender.getParameters();
            if(!p.encodings) {
                p.encodings = encodings;
                tr.sender.setParameters(p);
            }
        } catch(e) {
        }
    }

    // c.stream might be different from stream if there's a filter
    c.stream.getTracks().forEach(addUpTrack);

    stream.onaddtrack = function(e) {
        addUpTrack(e.track);
    };

    stream.onremovetrack = function(e) {
        let t = e.track;

        /** @type {RTCRtpSender} */
        let sender;
        c.pc.getSenders().forEach(s => {
            if(s.track === t)
                sender = s;
        });
        if(sender) {
            c.pc.removeTrack(sender);
        } else {
            console.warn('Removing unknown track');
        }

        let found = false;
        c.pc.getSenders().forEach(s => {
            if(s.track)
                found = true;
        });
        if(!found) {
            stream.onaddtrack = null;
            stream.onremovetrack = null;
            c.close();
        }
    };

    c.onstats = gotUpStats;
    c.setStatsInterval(2000);
}

/**
 * Replaces c with a freshly created stream, duplicating any relevant
 * parameters in c.userdata.
 *
 * @param {Stream} c
 * @returns {Promise<Stream>}
 */
async function replaceUpStream(c) {
    await removeFilter(c);
    let cn = newUpStream(c.localId);
    cn.label = c.label;
    if(c.userdata.filterDefinition)
        cn.userdata.filterDefinition = c.userdata.filterDefinition;
    if(c.userdata.onclose)
        cn.userdata.onclose = c.userdata.onclose;
    let media = /** @type{HTMLVideoElement} */
        (document.getElementById('media-' + c.localId));
    try {
        await setUpStream(cn, c.stream);
    } catch(e) {
        console.error(e);
        displayError(e);
        cn.close();
        c.close();
        return null;
    }

    await setMedia(cn,
                   cn.label === 'camera' && getSettings().mirrorView,
                   cn.label === 'video' && media);

    return cn;
}

/**
 * Replaces all up streams with the given label.  If label is null,
 * replaces all up stream.
 *
 * @param {string} label
 */
async function replaceUpStreams(label) {
    let promises = [];
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(label && c.label !== label)
            continue
        promises.push(replaceUpStream(c));
    }
    await Promise.all(promises);
}

/**
 * Closes and reopens the camera then replaces the camera stream.
 */
function replaceCameraStream() {
    let c = findUpMedia('camera');
    if(c)
        addLocalMedia(c.localId);
}

/**
 * @param {string} [localId]
 * @param {boolean} [audioOnly]
 */
async function addLocalMedia(localId, audioOnly) {
    let settings = getSettings();

    /** @type{boolean|MediaTrackConstraints} */
    let audio = settings.audio ? {deviceId: settings.audio} : true;
    /** @type{boolean|MediaTrackConstraints} */
    let video = audioOnly ? false : (settings.video ? {deviceId: settings.video} : true);
    if(audioOnly && !audio)
        audio = true;

    if(video && typeof video === 'object') {
        let resolution = settings.resolution;
        if(resolution) {
            video.width = { ideal: resolution[0] };
            video.height = { ideal: resolution[1] };
        } else if(settings.blackboardMode) {
            video.width = { min: 640, ideal: 1920 };
            video.height = { min: 400, ideal: 1080 };
        } else {
            video.aspectRatio = { ideal: 4/3 };
        }
    }

    if(audio && typeof audio === 'object') {
        if(!settings.preprocessing) {
            audio.echoCancellation = false;
            audio.noiseSuppression = false;
            audio.autoGainControl = false;
        }
    }

    let old = serverConnection.findByLocalId(localId);
    if(old) {
        // make sure that the camera is released before we try to reopen it
        await removeFilter(old);
        stopStream(old.stream);
    }

    let constraints = {audio: audio, video: video};
    /** @type {MediaStream} */
    let stream = null;
    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch(e) {
        let retry = {audio: true, video: !audioOnly};
        try {
            stream = await navigator.mediaDevices.getUserMedia(retry);
        } catch(e2) {
            displayError(e2);
            return;
        }
    }

    setMediaChoices(true);

    let c;

    try {
        c = newUpStream(localId);
    } catch(e) {
        console.log(e);
        displayError(e);
        return;
    }

    c.label = 'camera';

    if(settings.filter) {
        let filter = filters[settings.filter];
        if(filter)
            c.userdata.filterDefinition = filter;
        else
            displayWarning(`Filtro desconhecido ${settings.filter}`);
    }

    try {
        await setUpStream(c, stream);
        await setMedia(c, settings.mirrorView);
        spartanHookLocalTalk(stream);
    } catch(e) {
        console.error(e);
        displayError(e);
        c.close();
    }
    setButtonsVisibility();
}

let safariScreenshareDone = false;

async function addShareMedia() {
    if(!safariScreenshareDone) {
        if(isSafari()) {
            let ok = confirm(
                'No Safari a partilha de tela costuma travar depois de um tempo. ' +
                    'Quer tentar mesmo assim?'
            );
            if(!ok)
                return
        }
        safariScreenshareDone = true;
    }

    /** @type {MediaStream} */
    let stream = null;
    try {
        if(!('getDisplayMedia' in navigator.mediaDevices))
            throw new Error('Este navegador não compartilha tela');
        /** @type {any} */
        let shareOpts = {
            video: true,
            audio: true,
            systemAudio: 'include',
        };
        try {
            stream = await navigator.mediaDevices.getDisplayMedia(shareOpts);
        } catch(e) {
            if(e && (e.name === 'NotAllowedError' || e.name === 'AbortError'))
                throw e;
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true,
            });
        }
        if(!window._spartanShareHint) {
            window._spartanShareHint = true;
            displayMessage(
                'No Windows, marque compartilhar áudio e escolha tela inteira ou aba (não uma janela).'
            );
        }
    } catch(e) {
        console.error(e);
        displayError(e);
        return;
    }

    let c = newUpStream();
    c.label = 'screenshare';
    await setUpStream(c, stream);
    await setMedia(c);
    setButtonsVisibility();
}

/**
 * @param {File} file
 */
async function addFileMedia(file) {
    let url = URL.createObjectURL(file);
    let video = document.createElement('video');
    video.src = url;
    video.controls = true;
    let stream;
    /** @ts-ignore */
    if(video.captureStream)
        /** @ts-ignore */
        stream = video.captureStream();
    /** @ts-ignore */
    else if(video.mozCaptureStream)
        /** @ts-ignore */
        stream = video.mozCaptureStream();
    else {
        displayError("Este navegador não reproduz arquivo");
        return;
    }

    let c = newUpStream();
    c.label = 'video';
    c.userdata.onclose = function() {
        let media = /** @type{HTMLVideoElement} */
            (document.getElementById('media-' + this.localId));
        if(media && media.src) {
            URL.revokeObjectURL(media.src);
            media.src = null;
        }
    };
    await setUpStream(c, stream);

    let presenting = !!findUpMedia('camera');
    let muted = getSettings().localMute;
    if(presenting && !muted) {
        setLocalMute(true, true);
        displayWarning('Seu microfone foi silenciado');
    }

    await setMedia(c, false, video);
    c.userdata.play = true;
    setButtonsVisibility();
}

/**
 * @param {MediaStream} s
 */
function stopStream(s) {
    s.getTracks().forEach(t => {
        try {
            t.stop();
        } catch(e) {
            console.warn(e);
        }
    });
}

/**
 * closeUpMedia closes all up connections with the given label.  If label
 * is null, it closes all up connections.
 *
 * @param {string} [label]
*/
function closeUpMedia(label) {
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(label && c.label !== label)
            continue
        c.close();
    }
}

/**
 * @param {string} label
 * @returns {Stream}
 */
function findUpMedia(label) {
    if(!serverConnection)
        return null;
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(c.label === label)
            return c;
    }
    return null;
}

/**
 * @param {boolean} mute
 */
function muteLocalTracks(mute) {
    if(!serverConnection)
        return;
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(c.label === 'camera') {
            let stream = c.stream;
            stream.getTracks().forEach(t => {
                if(t.kind === 'audio') {
                    t.enabled = !mute;
                }
            });
        }
    }
}

/**
 * @param {string} id
 * @param {boolean} force
 * @param {boolean} [value]
 */
function forceDownRate(id, force, value) {
    let c = serverConnection.down[id];
    if(!c)
        throw new Error("Unknown down stream");
    if('requested' in c.userdata) {
        if(force)
            c.userdata.requested.force = !!value;
        else
            delete(c.userdata.requested.force);
    } else {
        if(force)
            c.userdata.requested = {force: value};
    }
    reconsiderDownRate(id);
}

/**
 * Maps 'video' to 'video-low'.  Returns null if nothing changed.
 *
 * @param {string[]} requested
 * @returns {string[]}
 */
function mapVideoToLow(requested) {
    let result = [];
    let found = false;
    for(let i = 0; i < requested.length; i++) {
        let r = requested[i];
        if(r === 'video') {
            r = 'video-low';
            found = true;
        }
        result.push(r);
    }
    if(!found)
        return null;
    return result;
}

/**
 * Reconsider the video track requested for a given down stream.
 *
 * @param {string} [id] - the id of the track to reconsider, all if null.
 */
function reconsiderDownRate(id) {
    if(!serverConnection)
        return;
    if(!id) {
        for(let id in serverConnection.down) {
            reconsiderDownRate(id);
        }
        return;
    }
    let c = serverConnection.down[id];
    if(!c)
        throw new Error("Unknown down stream");
    let normalrequest = mapRequestLabel(getSettings().request, c.label);

    let requestlow = mapVideoToLow(normalrequest);
    if(requestlow === null)
        return;

    let old = c.userdata.requested;
    let low = false;
    if(old && ('force' in old)) {
        low = old.force;
    } else {
        let media = /** @type {HTMLVideoElement} */
            (document.getElementById('media-' + c.localId));
        if(!media)
            throw new Error("No media for stream");
        let w = media.scrollWidth;
        let h = media.scrollHeight;
        if(w && h && w * h <= 320 * 240) {
            low = true;
        }
    }

    if(low !== !!(old && old.low)) {
        if('requested' in c.userdata)
            c.userdata.requested.low = low;
        else
            c.userdata.requested = {low: low};
        c.request(low ? requestlow : null);
    }
}

let reconsiderDownRateTimer = null;

/**
 * Schedules reconsiderDownRate() to be run later.  The delay avoids too
 * much recomputations when resizing the window.
 */
function scheduleReconsiderDownRate() {
    if(reconsiderDownRateTimer)
        return;
    reconsiderDownRateTimer =
        setTimeout(() => {
            reconsiderDownRateTimer = null;
            reconsiderDownRate();
        }, 200);
}

/**
 * setMedia adds a new media element corresponding to stream c.
 *
 * @param {Stream} c
 * @param {boolean} [mirror]
 *     - whether to mirror the video
 * @param {HTMLVideoElement} [video]
 *     - the video element to add.  If null, a new element with custom
 *       controls will be created.
 */
async function setMedia(c, mirror, video) {
    let div = document.getElementById('peer-' + c.localId);
    if(!div) {
        div = document.createElement('div');
        div.id = 'peer-' + c.localId;
        div.classList.add('peer');
        let peersdiv = document.getElementById('peers');
        peersdiv.appendChild(div);
    }

    showHideMedia(c, div)

    let media = /** @type {HTMLVideoElement} */
        (document.getElementById('media-' + c.localId));
    if(!media) {
        if(video) {
            media = video;
        } else {
            media = document.createElement('video');
            if(c.up)
                media.muted = true;
        }

        media.classList.add('media');
        media.autoplay = true;
        media.playsInline = true;
        media.controls = false;
        media.id = 'media-' + c.localId;
        div.appendChild(media);
        addCustomControls(media, div, c, !!video);
        spartanBindPeerUi(div, media);
    }

    media.controls = false;

    if(mirror)
        media.classList.add('mirror');
    else
        media.classList.remove('mirror');

    if(!video && media.srcObject !== c.stream)
        media.srcObject = c.stream;

    if(!c.up) {
        media.onfullscreenchange = function(e) {
            forceDownRate(c.id, document.fullscreenElement === media, false);
        }
    }

    let label = document.getElementById('label-' + c.localId);
    if(!label) {
        label = document.createElement('div');
        label.id = 'label-' + c.localId;
        label.classList.add('label');
        div.appendChild(label);
    }

    setLabel(c);
    setMediaStatus(c);

    showVideo();
    resizePeers();
    spartanRefreshHideOwnButton();
    if(c.source || c.up) {
        let uid = c.up ? serverConnection.id : c.source;
        let row = uid && document.getElementById('user-' + uid);
        if(row)
            spartanFillUserLives(uid, row);
    }
}

/**
 * Clique foca a live; loadedmetadata marca retrato.
 * @param {HTMLElement} div
 * @param {HTMLVideoElement} media
 */
function spartanBindPeerUi(div, media) {
    if(div.dataset.spartanUi === '1')
        return;
    div.dataset.spartanUi = '1';
    media.addEventListener('loadedmetadata', function() {
        if(media.videoWidth > 0 && media.videoWidth < media.videoHeight)
            div.classList.add('peer-portrait');
        else
            div.classList.remove('peer-portrait');
        if(media.videoWidth > 0 && serverConnection) {
            let localId = media.id.replace(/^media-/, '');
            let c = spartanFindByLocalId(localId);
            if(c) {
                spartanHasVideo[c.id] = true;
            }
            spartanRefreshAllMedia();
            return;
        }
        resizePeers();
    });
    div.addEventListener('click', function(e) {
        let t = /** @type{HTMLElement} */(e.target);
        if(t.closest && t.closest('.video-controls, .top-video-controls'))
            return;
        if(div.classList.contains('peer-fs'))
            return;
        let vc = document.getElementById('video-container');
        if(!vc)
            return;
        if(div.classList.contains('peer-focus')) {
            div.classList.remove('peer-focus');
            vc.classList.remove('peer-focus-mode');
        } else {
            document.querySelectorAll('#peers .peer-focus').forEach(function(p) {
                p.classList.remove('peer-focus');
            });
            div.classList.add('peer-focus');
            vc.classList.add('peer-focus-mode');
        }
        resizePeers();
    });
}

document.addEventListener('keydown', function(e) {
    if(e.key !== 'Escape')
        return;
    let nav = document.getElementById('sidebarnav');
    if(nav && nav.classList.contains('spartan-settings-open')) {
        closeNav();
        e.preventDefault();
        return;
    }
    let chat = document.getElementById('chat');
    if(chat && chat.classList.contains('spartan-chat-open')) {
        spartanSetChatOpen(false);
        e.preventDefault();
        return;
    }
    let fs = document.querySelector('.peer.peer-fs');
    if(fs) {
        fs.classList.remove('peer-fs');
        document.body.classList.remove('spartan-peer-fs');
        e.preventDefault();
        return;
    }
    let focus = document.querySelector('#peers .peer.peer-focus');
    let vc = document.getElementById('video-container');
    if(focus && vc && vc.classList.contains('peer-focus-mode')) {
        focus.classList.remove('peer-focus');
        vc.classList.remove('peer-focus-mode');
        resizePeers();
    }
});

function spartanSyncNativeFs() {
    if(document.fullscreenElement || document.webkitFullscreenElement)
        return;
    document.querySelectorAll('.peer-fs').forEach(function(p) {
        p.classList.remove('peer-fs');
    });
    document.body.classList.remove('spartan-peer-fs');
}
document.addEventListener('fullscreenchange', spartanSyncNativeFs);
document.addEventListener('webkitfullscreenchange', spartanSyncNativeFs);


/**
 * @param {Stream} c
 * @param {HTMLElement} elt
 */
function showHideMedia(c, elt) {
    let real = streamHasRealVideo(c.stream) || c.label === 'screenshare';
    if(real)
        spartanHasVideo[c.id] = true;
    let display = false;
    if(spartanIsOuvinte() && !c.up) {
        display = false;
    } else if(real) {
        if(c.up)
            display = !spartanHideOwn && !spartanHideOwnStream[c.id];
        else
            display = !!spartanWatch[c.id];
    }
    if(display)
        elt.classList.remove('peer-hidden');
    else
        elt.classList.add('peer-hidden');
}

/**
 * resetMedia resets the source stream of the media element associated
 * with c.  This has the side-effect of resetting any frozen frames.
 *
 * @param {Stream} c
 */
function resetMedia(c) {
    let media = /** @type {HTMLVideoElement} */
        (document.getElementById('media-' + c.localId));
    if(!media) {
        console.error("Resetting unknown media element")
        return;
    }
    media.srcObject = media.srcObject;
}

/**
 * @param {Element} elt
 */
function cloneHTMLElement(elt) {
    if(!(elt instanceof HTMLElement))
        throw new Error('Unexpected element type');
    return /** @type{HTMLElement} */(elt.cloneNode(true));
}

/**
 * @param {HTMLVideoElement} media
 * @param {HTMLElement} container
 * @param {Stream} c
 * @param {boolean} toponly
 */
function addCustomControls(media, container, c, toponly) {
    if(!toponly && !document.getElementById('controls-' + c.localId)) {
        media.controls = false;

        let template =
            document.getElementById('videocontrols-template').firstElementChild;
        let controls = cloneHTMLElement(template);
        controls.id = 'controls-' + c.localId;

        let volume = getVideoButton(controls, 'volume');

        if(c.up && c.label === 'camera') {
            volume.remove();
        } else {
            setVolumeButton(media.muted,
                            getVideoButton(controls, "volume-mute"),
                            getVideoButton(controls, "volume-slider"));
        }
        container.appendChild(controls);
    }

    if(!document.getElementById('topcontrols-' + c.localId)) {
        let toptemplate =
            document.getElementById('topvideocontrols-template').firstElementChild;
        let topcontrols = cloneHTMLElement(toptemplate);
        topcontrols.id = 'topcontrols-' + c.localId;
        container.appendChild(topcontrols);
    }
    registerControlHandlers(c.localId, media, container);
}

/**
 * @param {HTMLElement} container
 * @param {string} name
 */
function getVideoButton(container, name) {
    return /** @type {HTMLElement} */(container.getElementsByClassName(name)[0]);
}

/**
 * @param {boolean} muted
 * @param {HTMLElement} button
 * @param {HTMLElement} slider
 */
function setVolumeButton(muted, button, slider) {
    if(!muted) {
        button.classList.remove("fa-volume-mute");
        button.classList.add("fa-volume-up");
    } else {
        button.classList.remove("fa-volume-up");
        button.classList.add("fa-volume-mute");
    }

    if(!(slider instanceof HTMLInputElement))
        throw new Error("Couldn't find volume slider");
    slider.disabled = muted;
}

/**
 * @param {string} localId
 * @param {HTMLVideoElement} media
 * @param {HTMLElement} container
 */
function registerControlHandlers(localId, media, container) {
    let stop = getVideoButton(container, 'video-stop');
    if(stop) {
        stop.onclick = function(event) {
            event.preventDefault();
            event.stopPropagation();
            try {
                if(document.fullscreenElement && document.exitFullscreen)
                    document.exitFullscreen();
                else if(document.webkitFullscreenElement && document.webkitExitFullscreen)
                    document.webkitExitFullscreen();
            } catch(e) {}
            container.classList.remove('peer-fs');
            document.body.classList.remove('spartan-peer-fs');
            container.classList.remove('peer-focus');
            let vc = document.getElementById('video-container');
            if(vc)
                vc.classList.remove('peer-focus-mode');
            try {
                let c = spartanFindByLocalId(localId);
                if(c)
                    spartanToggleLive(c);
                else
                    container.classList.add('peer-hidden');
            } catch(e) {
                console.error(e);
                displayError(e);
            }
        };
    }

    let volume = getVideoButton(container, 'volume');
    if (volume) {
        volume.onclick = function(event) {
            let target = /** @type{HTMLElement} */(event.target);
            if(!target.classList.contains('volume-mute'))
                // if click on volume slider, do nothing
                return;
            event.preventDefault();
            event.stopPropagation();
            media.muted = !media.muted;
            setVolumeButton(media.muted, target,
                            getVideoButton(volume, "volume-slider"));
        };
        volume.oninput = function() {
          let slider = /** @type{HTMLInputElement} */
              (getVideoButton(volume, "volume-slider"));
          media.volume = parseFloat(slider.value)/100;
        };
    }

    let pip = getVideoButton(container, 'pip');
    if(pip) {
        if(HTMLVideoElement.prototype.requestPictureInPicture) {
            pip.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                if(media.requestPictureInPicture) {
                    media.requestPictureInPicture();
                } else {
                    displayWarning('Miniplayer não é suportado.');
                }
            };
        } else {
            pip.style.display = 'none';
        }
    }

    let rotate = getVideoButton(container, 'rotate');
    if(rotate) {
        rotate.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            let cur = parseInt(media.dataset.spartanRot || '0', 10);
            cur = (cur + 90) % 360;
            media.dataset.spartanRot = String(cur);
            media.style.transform = 'rotate(' + cur + 'deg)';
        };
    }

    let fs = getVideoButton(container, 'fullscreen');
    if(fs) {
        fs.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            let nativeFs = document.fullscreenElement || document.webkitFullscreenElement;
            let on = !container.classList.contains('peer-fs') && !nativeFs;
            document.querySelectorAll('.peer-fs').forEach(function(p) {
                p.classList.remove('peer-fs');
            });
            if(on) {
                container.classList.add('peer-fs');
                document.body.classList.add('spartan-peer-fs');
                let target = media || container;
                let req = target.requestFullscreen || target.webkitRequestFullscreen ||
                    container.requestFullscreen || container.webkitRequestFullscreen;
                if(req) {
                    try {
                        let p = req.call(target);
                        if(p && p.catch)
                            p.catch(function() {
                                try {
                                    let r2 = container.requestFullscreen || container.webkitRequestFullscreen;
                                    if(r2) r2.call(container);
                                } catch(err2) {}
                            });
                    } catch(err) {}
                }
            } else {
                document.body.classList.remove('spartan-peer-fs');
                try {
                    if(document.fullscreenElement && document.exitFullscreen)
                        document.exitFullscreen();
                    else if(document.webkitFullscreenElement &&
                            document.webkitExitFullscreen)
                        document.webkitExitFullscreen();
                } catch(err) {}
            }
        };
    }
}

/**
 * @param {string} localId
 */
function delMedia(localId) {
    let mediadiv = document.getElementById('peers');
    let peer = document.getElementById('peer-' + localId);
    if(!peer)
        throw new Error('Removing unknown media');

    let media = /** @type{HTMLVideoElement} */
        (document.getElementById('media-' + localId));

    if(peer.classList.contains('peer-focus')) {
        let vc = document.getElementById('video-container');
        if(vc)
            vc.classList.remove('peer-focus-mode');
    }
    peer.classList.remove('peer-fs');
    document.body.classList.remove('spartan-peer-fs');

    media.srcObject = null;
    mediadiv.removeChild(peer);

    setButtonsVisibility();
    resizePeers();
    hideVideo();
}

/**
 * @param {Stream} c
 */
function setMediaStatus(c) {
    let state = c && c.pc && c.pc.iceConnectionState;
    let good = state === 'connected' || state === 'completed';

    let media = document.getElementById('media-' + c.localId);
    if(!media) {
        console.warn('Setting status of unknown media.');
        return;
    }
    if(good) {
        media.classList.remove('media-failed');
        if(c.userdata.play) {
            if(media instanceof HTMLMediaElement)
                media.play().catch(e => {
                    console.error(e);
                    displayError(e);
                });
            delete(c.userdata.play);
        }
    } else {
        media.classList.add('media-failed');
    }

    if(!c.up && state === 'failed') {
        let from = c.username ?
            `from user ${c.username}` :
            'from anonymous user';
        displayWarning(`Não recebeu a mídia de ${from}, tentando de novo...`);
    }
}


/**
 * @param {Stream} c
 * @param {string} [fallback]
 */
function setLabel(c, fallback) {
    let label = document.getElementById('label-' + c.localId);
    if(!label)
        return;
    let kind = spartanLiveKindCaption(c);
    if(c.up) {
        let same = spartanSameKindLives(c);
        label.textContent = same.length <= 1 ? 'Minha Live' : ('Minha Live - ' + kind);
        label.classList.remove('label-fallback');
        return;
    }
    let name = c.username ? spartanDisplayName(c.username) : '';
    if(name) {
        label.textContent = name + ' - ' + kind;
        label.classList.remove('label-fallback');
    } else if(fallback && !/^\d/.test(String(fallback))) {
        label.textContent = String(fallback) + ' - ' + kind;
        label.classList.add('label-fallback');
    } else {
        label.textContent = kind;
        label.classList.remove('label-fallback');
    }
}

function resizePeers() {
    if (!serverConnection)
        return;
    let peers = document.getElementById('peers');
    if(!peers)
        return;
    peers.classList.remove('peers-split');
    let tiles = Array.prototype.slice.call(
        peers.querySelectorAll('.peer:not(.peer-hidden)')
    );
    let count = tiles.length;
    let container = document.getElementById('video-container');
    tiles.forEach(function(t) {
        let m = t.querySelector('.media');
        if(m)
            m.style.maxHeight = '';
    });
    if(container && container.classList.contains('peer-focus-mode')) {
        peers.style.gridTemplateColumns = '';
        peers.style.gridTemplateRows = '';
        return;
    }
    if (!count)
        return;
    let slots = count <= 1 ? 1 : Math.min(SPARTAN_GRID_MAX, Math.ceil(count / 2) * 2);
    let columns = slots === 1 ? 1 : 2;
    let rows = Math.ceil(slots / columns);
    peers.style.gridTemplateColumns = columns === 1 ? '1fr' : '1fr 1fr';
    peers.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';
}

/**
 * Lexicographic order, with case differences secondary.
 * @param{string} a
 * @param{string} b
 */
function stringCompare(a, b) {
    let la = a.toLowerCase();
    let lb = b.toLowerCase();
    if(la < lb)
        return -1;
    else if(la > lb)
        return +1;
    else if(a < b)
        return -1;
    else if(a > b)
        return +1;
    return 0
}

/**
 * @param {string} v
 */
function dateFromInput(v) {
    let d = new Date(v);
    if(d.toString() === 'Invalid Date')
        throw new Error('Invalid date');
    return d;
}

/**
 * @param {Date} d
 */
function dateToInput(d) {
    let dd = new Date(d);
    dd.setMinutes(dd.getMinutes() - dd.getTimezoneOffset());
    return dd.toISOString().slice(0, -1);
}

function inviteMenu() {
    let d = /** @type {HTMLDialogElement} */
        (document.getElementById('invite-dialog'));
    if(!('HTMLDialogElement' in window) || !d.showModal) {
        displayError("Este navegador não abre essa janela");
        return;
    }
    d.returnValue = '';
    let c = getButtonElement('invite-cancel');
    c.onclick = function(e) { d.close('cancel'); };
    let u = getInputElement('invite-username');
    u.value = '';
    let now = new Date();
    now.setMilliseconds(0);
    now.setSeconds(0);
    let nb = getInputElement('invite-not-before');
    nb.min = dateToInput(now);
    let ex = getInputElement('invite-expires');
    let expires = new Date(now);
    expires.setDate(expires.getDate() + 2);
    ex.min = dateToInput(now);
    ex.value = dateToInput(expires);
    d.showModal();
}

document.getElementById('invite-dialog').onclose = function(e) {
    if(!(this instanceof HTMLDialogElement))
        throw new Error('Unexpected type for this');
    let dialog = /** @type {HTMLDialogElement} */(this);
    if(dialog.returnValue !== 'invite')
        return;
    let u = getInputElement('invite-username');
    let username = u.value.trim() || null;
    let nb = getInputElement('invite-not-before');
    let notBefore = null;
    if(nb.value) {
        try {
            notBefore = dateFromInput(nb.value);
        } catch(e) {
            displayError(`Data inválida (${nb.value}): ${e.message}`);
            return;
        }
    }
    let ex = getInputElement('invite-expires');
    let expires = null;
    if(ex.value) {
        try {
            expires = dateFromInput(ex.value);
        } catch(e) {
            displayError(`Data inválida (${ex.value}): ${e.message}`);
            return;
        }
    }
    let template = {}
    if(username)
        template.username = username;
    if(notBefore)
        template['not-before'] = notBefore;
    if(expires)
        template.expires = expires;
    makeToken(template);
};

/**
 * @param {HTMLElement} elt
 */
function userMenu(elt) {
    if(!elt.id.startsWith('user-'))
        throw new Error('Unexpected id for user menu');
    let id = elt.id.slice('user-'.length);
    let user = serverConnection.users[id];
    if(!user)
        throw new Error("Couldn't find user")
    let items = [];
    if(id === serverConnection.id) {
        let mydata = serverConnection.users[serverConnection.id].data;
        if(mydata['raisehand'])
            items.push({label: 'Abaixar a mão', onClick: () => {
                serverConnection.userAction(
                    'setdata', serverConnection.id, {'raisehand': null},
                );
            }});
        else
            items.push({label: 'Levantar a mão', onClick: () => {
                serverConnection.userAction(
                    'setdata', serverConnection.id, {'raisehand': true},
                );
            }});
        if(serverConnection.version !== "1" &&
           serverConnection.permissions.indexOf('token') >= 0) {
            items.push({label: 'Convidar usuário', onClick: () => {
                inviteMenu();
            }});
        }
        if(serverConnection.permissions.indexOf('present') >= 0 && canFile())
            items.push({label: 'Transmitir arquivo', onClick: presentFile});
        items.push({label: 'Reiniciar mídia', onClick: renegotiateStreams});
    } else {
        items.push({label: 'Enviar arquivo', onClick: () => {
            sendFile(id);
        }});
        if(serverConnection.permissions.indexOf('op') >= 0) {
            items.push({type: 'seperator'}); // sic
            if(user.permissions.indexOf('present') >= 0)
                items.push({label: 'Proibir apresentar', onClick: () => {
                    serverConnection.userAction('unpresent', id);
                }});
            else
                items.push({label: 'Permitir apresentar', onClick: () => {
                    serverConnection.userAction('present', id);
                }});
            items.push({label: 'Silenciar', onClick: () => {
                serverConnection.userMessage('mute', id);
            }});
            items.push({label: 'Expulsar', onClick: () => {
                serverConnection.userAction('kick', id);
            }});
            items.push({label: 'Identificar', onClick: () => {
                serverConnection.userAction('identify', id);
            }});
        }
    }
    /** @ts-ignore */
    new Contextual({
        items: items,
    });
}

/**
 * @param {string} id
 * @param {user} userinfo
 */
function addUser(id, userinfo) {
    let div = document.getElementById('users');
    let user = document.createElement('div');
    user.id = 'user-' + id;
    user.classList.add("user-p");
    setUserStatus(id, user, userinfo);
    user.addEventListener('click', function(e) {
        let elt = e.currentTarget;
        if(!elt || !(elt instanceof HTMLElement))
            throw new Error("Couldn't find user div");
        userMenu(elt);
    });

    let us = div.children;

    if(id === serverConnection.id) {
        if(us.length === 0)
            div.appendChild(user);
        else
            div.insertBefore(user, us[0]);
        return;
    }

    if(userinfo.username) {
        for(let i = 0; i < us.length; i++) {
            let child = us[i];
            let childid = child.id.slice('user-'.length);
            if(childid === serverConnection.id)
                continue;
            let childuser = serverConnection.users[childid] || null;
            let childname = (childuser && childuser.username) || null;
            if(!childname || stringCompare(childname, userinfo.username) > 0) {
                div.insertBefore(user, child);
                return;
            }
        }
    }

    div.appendChild(user);
}

 /**
  * @param {string} id
  * @param {user} userinfo
  */
function changeUser(id, userinfo) {
    let elt = document.getElementById('user-' + id);
    if(!elt) {
        console.warn('Unknown user ' + id);
        return;
    }
    setUserStatus(id, elt, userinfo);
}

/**
 * @param {string} id
 * @param {HTMLElement} elt
 * @param {user} userinfo
 */
function setUserStatus(id, elt, userinfo) {
    let name = elt.querySelector('.user-name');
    if(!name) {
        elt.textContent = '';
        let row = document.createElement('div');
        row.className = 'user-row';
        let avatar = document.createElement('span');
        avatar.className = 'user-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        row.appendChild(avatar);
        let dot = document.createElement('span');
        dot.className = 'user-talk-dot';
        dot.setAttribute('aria-hidden', 'true');
        row.appendChild(dot);
        name = document.createElement('span');
        name.className = 'user-name';
        row.appendChild(name);
        let muteBtn = document.createElement('button');
        muteBtn.type = 'button';
        muteBtn.className = 'user-mute-btn';
        muteBtn.textContent = 'Mudo';
        muteBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            spartanToggleUserMute(id);
        });
        row.appendChild(muteBtn);
        elt.appendChild(row);
        let lives = document.createElement('div');
        lives.className = 'user-lives';
        elt.appendChild(lives);
    } else {
        let row = elt.querySelector('.user-row');
        if(row && !row.querySelector('.user-avatar')) {
            let avatar = document.createElement('span');
            avatar.className = 'user-avatar';
            avatar.setAttribute('aria-hidden', 'true');
            row.insertBefore(avatar, row.firstChild);
        }
        if(row && !row.querySelector('.user-talk-dot')) {
            let dot = document.createElement('span');
            dot.className = 'user-talk-dot';
            dot.setAttribute('aria-hidden', 'true');
            let nm = row.querySelector('.user-name');
            row.insertBefore(dot, nm || null);
        }
    }
    name.textContent = userinfo.username ? spartanDisplayName(userinfo.username) : '(anônimo)';
    if(userinfo.data.raisehand)
        elt.classList.add('user-status-raisehand');
    else
        elt.classList.remove('user-status-raisehand');
    elt.classList.remove('user-status-microphone');
    elt.classList.remove('user-status-camera');
    spartanFillUserLives(id, elt);
}

/**
 * @param {string} id
 */
function delUser(id) {
    let div = document.getElementById('users');
    let user = document.getElementById('user-' + id);
    div.removeChild(user);
}

/**
 * @param {string} id
 * @param {string} kind
 */
function gotUser(id, kind) {
    switch(kind) {
    case 'add':
        addUser(id, serverConnection.users[id]);
        if(Object.keys(serverConnection.users).length === 3)
            reconsiderSendParameters();
        break;
    case 'delete':
        delUser(id);
        if(Object.keys(serverConnection.users).length < 3)
            scheduleReconsiderParameters();
        break;
    case 'change':
        changeUser(id, serverConnection.users[id]);
        break;
    default:
        console.warn('Unknown user kind', kind);
        break;
    }
}

function displayUsername() {
    document.getElementById('userspan').textContent = spartanDisplayName(serverConnection.username);
    let op = serverConnection.permissions.indexOf('op') >= 0;
    let present = serverConnection.permissions.indexOf('present') >= 0;
    let ouvinte = spartanIsOuvinte();
    let text = '';
    if(op && present)
        text = '(Admin · no palco)';
    else if(op)
        text = 'Admin';
    else if(ouvinte)
        text = 'Ouvinte';
    else if(present)
        text = 'Verificado';
    document.getElementById('permspan').textContent = text;
}

let presentRequested = null;

/**
 * @param {string} s
 */
function capitalise(s) {
    if(s.length <= 0)
        return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Primeira letra de cada palavra, só para mostrar na UI.
 * @param {string} [s]
 */
function spartanDisplayName(s) {
    if(!s)
        return '(anônimo)';
    return String(s).replace(/\S+/g, function(w) {
        return w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1);
    });
}

/**
 * @param {string} title
 */
function setTitle(title) {
    function set(title) {
        document.title = title;
        document.getElementById('title').textContent = title;
    }
    if(title)
        set(title);
    else
        set('Galène');
}

/**
 * Under Safari, we request access to the camera at startup in order to
 * enable autoplay.  The camera stream is stored in safariStream.
 *
 * @type {MediaStream}
 */
let safariStream = null;

async function openSafariStream() {
    if(!isSafari())
        return;

    if(!safariStream)
        safariStream = await navigator.mediaDevices.getUserMedia({audio: true})
}

async function closeSafariStream() {
    if(!safariStream)
        return;
    stopStream(safariStream);
    safariStream = null;
}

/**
 * @this {ServerConnection}
 * @param {string} kind
 * @param {string} group
 * @param {Array<string>} perms
 * @param {Record<string,any>} status
 * @param {Record<string,any>} data
 * @param {string} error
 * @param {string} message
 */
async function gotJoined(kind, group, perms, status, data, error, message) {
    let present = presentRequested;
    presentRequested = null;

    switch(kind) {
    case 'fail':
        if(probingState === 'probing' && error === 'need-username') {
            probingState = 'need-username';
            setVisibility('passwordform', false);
        } else {
            token = null;
            displayError('O servidor disse: ' + message);
        }
        closeSafariStream();
        this.close();
        setButtonsVisibility();
        return;
    case 'redirect':
        closeSafariStream();
        this.close();
        token = null;
        document.location.href = message;
        return;
    case 'leave':
        closeSafariStream();
        this.close();
        setButtonsVisibility();
        setChangePassword(null); setAdminPanel(true);
        return;
    case 'join':
    case 'change':
        if(probingState === 'probing') {
            probingState = 'success';
            setVisibility('userform', false);
            setVisibility('passwordform', false);
            closeSafariStream();
            this.close();
            setButtonsVisibility();
            return;
        } else {
            token = null;
        }
        // don't discard endPoint and friends
        for(let key in status)
            groupStatus[key] = status[key];
        setTitle((status && status.displayName) || capitalise(group));
        displayUsername();
        setButtonsVisibility();
        setChangePassword(pwAuth &&
                          serverConnection.username
        );
        setAdminPanel();
        if(typeof spartanOnJoin==='function') spartanOnJoin();
        openSafariStream();
        if(kind === 'change')
            return;
        break;
    default:
        token = null;
        displayError('Não deu para entrar na sala');
        closeSafariStream();
        this.close();
        return;
    }

    let input = /** @type{HTMLTextAreaElement} */
        (document.getElementById('input'));
    input.placeholder = 'Digite /help para ajuda';
    setTimeout(() => {input.placeholder = '';}, 8000);

    if(status.locked)
        displayWarning('Esta sala está trancada');

    if(typeof RTCPeerConnection === 'undefined')
        displayWarning("Este navegador não tem WebRTC");
    else if(spartanIsOuvinte())
        this.request({'': ['audio']});
    else
        this.request({'': ['audio', 'video']});

    setLocalMute(true, true);

    if(('mediaDevices' in navigator) &&
       ('getUserMedia' in navigator.mediaDevices) &&
       serverConnection.permissions.indexOf('present') >= 0 &&
       !findUpMedia('camera')) {
        if(spartanIsOuvinte()) {
            displayMessage("Ouvinte: microfone para falar. Sem lives nem chat de texto.");
            spartanApplyOuvinteUi();
        } else if(present) {
            if(present === 'mike')
                updateSettings({video: ''});
            else if(present === 'both')
                delSetting('video');
            reflectSettings();

            let button = getButtonElement('presentbutton');
            button.disabled = true;
            try {
                await addLocalMedia(undefined, present === 'mike');
            } finally {
                button.disabled = false;
            }
            setLocalMute(true, true);
        } else {
            displayMessage(
                "Clique no microfone para falar"
            );
        }
    }
    spartanApplyOuvinteUi();
}

/**
 * @param {TransferredFile} f
 */
function gotFileTransfer(f) {
    f.onevent = gotFileTransferEvent;
    let p = document.createElement('p');
    if(f.up)
        p.textContent =
        `We have offered to send a file called "${f.name}" ` +
        `to user ${f.username}.`;
    else
        p.textContent =
        `User ${f.username} offered to send us a file ` +
        `called "${f.name}" of size ${f.size}.`
    let bno = null, byes = null;
    if(!f.up) {
        byes = document.createElement('button');
        byes.textContent = 'Aceitar';
        byes.onclick = function(e) {
            f.receive();
        };
        byes.id = "byes-" + f.fullid();
    }
    bno = document.createElement('button');
    bno.textContent = f.up ? 'Cancelar' : 'Recusar';
    bno.onclick = function(e) {
        f.cancel();
    };
    bno.id = "bno-" + f.fullid();
    let status = document.createElement('span');
    status.id = 'status-' + f.fullid();
    if(!f.up) {
        status.textContent =
            '(Choosing "Aceitar" will disclose your IP address.)';
    }
    let statusp = document.createElement('p');
    statusp.id = 'statusp-' + f.fullid();
    statusp.appendChild(status);
    let div = document.createElement('div');
    div.id = 'file-' + f.fullid();
    div.appendChild(p);
    if(byes)
        div.appendChild(byes);
    if(bno)
        div.appendChild(bno);
    div.appendChild(statusp);
    div.classList.add('message');
    div.classList.add('message-private');
    div.classList.add('message-row');
    let box = document.getElementById('box');
    box.appendChild(div);
    return div;
}

/**
 * @param {TransferredFile} f
 * @param {string} status
 * @param {number} [value]
 */
function setFileStatus(f, status, value) {
    let statuselt = document.getElementById('status-' + f.fullid());
    if(!statuselt)
        throw new Error("Couldn't find statusp");
    statuselt.textContent = status;
    if(value) {
        let progress = document.getElementById('progress-' + f.fullid());
         if(!progress || !(progress instanceof HTMLProgressElement))
            throw new Error("Couldn't find progress element");
        progress.value = value;
        let label = document.getElementById('progresstext-' + f.fullid());
        let percent = Math.round(100 * value / progress.max);
        label.textContent = `${percent}%`;
    }
}

/**
 * @param {TransferredFile} f
 * @param {number} [max]
 */
function createFileProgress(f, max) {
    let statusp = document.getElementById('statusp-' + f.fullid());
    if(!statusp)
        throw new Error("Couldn't find status div");
    /** @type HTMLProgressElement */
    let progress = document.createElement('progress');
    progress.id = 'progress-' + f.fullid();
    progress.classList.add('file-progress');
    progress.max = max;
    progress.value = 0;
    statusp.appendChild(progress);
    let progresstext = document.createElement('span');
    progresstext.id = 'progresstext-' + f.fullid();
    progresstext.textContent = '0%';
    statusp.appendChild(progresstext);
}

/**
 * @param {TransferredFile} f
 * @param {boolean} delyes
 * @param {boolean} delno
 * @param {boolean} [delprogress]
 */
function delFileStatusButtons(f, delyes, delno, delprogress) {
    let div = document.getElementById('file-' + f.fullid());
    if(!div)
        throw new Error("Couldn't find file div");
    if(delyes) {
        let byes = document.getElementById('byes-' + f.fullid())
        if(byes)
            div.removeChild(byes);
    }
    if(delno) {
        let bno = document.getElementById('bno-' + f.fullid())
        if(bno)
            div.removeChild(bno);
    }
    if(delprogress) {
        let statusp = document.getElementById('statusp-' + f.fullid());
        let progress = document.getElementById('progress-' + f.fullid());
        let progresstext =
            document.getElementById('progresstext-' + f.fullid());
        if(progress)
            statusp.removeChild(progress);
        if(progresstext)
            statusp.removeChild(progresstext);
    }
}

/**
 * @this {TransferredFile}
 * @param {string} state
 * @param {any} [data]
 */
function gotFileTransferEvent(state, data) {
    let f = this;
    switch(state) {
    case 'inviting':
        break;
    case 'connecting':
        delFileStatusButtons(f, true, false);
        setFileStatus(f, 'Conectando...');
        createFileProgress(f, f.size);
        break;
    case 'connected':
        setFileStatus(f, f.up ? 'Enviando...' : 'Recebendo...', f.datalen);
        break;
    case 'done':
        delFileStatusButtons(f, true, true, true);
        setFileStatus(f, 'Pronto.');
        if(!f.up) {
            let url = URL.createObjectURL(data);
            let a = document.createElement('a');
            a.href = url;
            a.textContent = f.name;
            a.download = f.name;
            a.type = f.mimetype;
            a.click();
            URL.revokeObjectURL(url);
        }
        break;
    case 'cancelled':
        delFileStatusButtons(f, true, true, true);
        if(data)
            setFileStatus(f, `Cancelled: ${data.toString()}.`);
        else
            setFileStatus(f, 'Cancelado.');
        break;
    case 'closed':
        break;
    default:
        console.error(`Unexpected state "${state}"`);
        f.cancel(`unexpected state "${state}" (this shouldn't happen)`);
        break;
    }
}

/**
 * @param {string} id
 * @param {string} dest
 * @param {string} username
 * @param {Date} time
 * @param {boolean} privileged
 * @param {string} kind
 * @param {string} error
 * @param {any} message
 */
function gotUserMessage(id, dest, username, time, privileged, kind, error, message) {
    switch(kind) {
    case 'kicked':
    case 'error':
    case 'warning':
    case 'info': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        let from = id ? (username || 'Anonymous') : 'The Server';
        displayError(`${from} disse: ${message}`, kind);
        break;
    }
    case 'mute': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        setLocalMute(true, true);
        let by = username ? ' by ' + username : '';
        displayWarning(`Seu microfone foi silenciado${by}`);
        break;
    }
    case 'clearchat': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        let id = message && message.id;
        let userId = message && message.userId;
        clearChat(id, userId);
        break;
    }
    case 'token': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        if(error) {
            displayError(`Falha no convite: ${message}`)
            return
        }
        if(typeof message !== 'object') {
            displayError('Convite inválido');
            return;
        }
        let f = formatToken(message, false);
        localMessage(f[0] + ': ' + f[1]);
        if('share' in navigator) {
            try {
                navigator.share({
                    title: `Invitation to Galene group ${message.group}`,
                    text: f[0],
                    url: f[1],
                });
            } catch(e) {
                console.warn("Share failed", e);
            }
        }
        break;
    }
    case 'tokenlist': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        if(error) {
            displayError(`Falha no convite: ${message}`)
            return
        }
        let s = '';
        for(let i = 0; i < message.length; i++) {
            let f = formatToken(message[i], true);
            s = s + f[0] + ': ' + f[1] + "\n";
        }
        localMessage(s);
        break;
    }
    case 'userinfo': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        let u = message.username ?
            'username ' + message.username :
            'unknown username';
        let a = message.address ?
            'address ' + message.address :
            'unknown address';
        localMessage(`User ${message.id} has ${u} and ${a}.`);
        break;
    }
    default:
        console.warn(`Got unknown user message ${kind}`);
        break;
    }
};

/**
 * @param {Object} token
 * @param {boolean} [details]
 */
function formatToken(token, details) {
    let url = new URL(window.location.href);
    let params = new URLSearchParams();
    params.append('token', token.token);
    url.search = params.toString();
    let foruser = '', by = '', togroup = '';
    if(token.username)
        foruser = ` for user ${token.username}`;
    if(details) {
        if(token.issuedBy)
            by = ' issued by ' + token.issuedBy;
        if(token.issuedAt) {
            if(by === '')
                by = ' issued at ' + (new Date(token.issuedAt)).toLocaleString();
            else
                by = by + ' at ' + (new Date(token.issuedAt)).toLocaleString();
        }
    } else {
        if(token.group)
            togroup = ' to group ' + token.group;
    }
    let since = '';
    if(token["not-before"])
        since = ` since ${(new Date(token['not-before'])).toLocaleString()}`
    /** @type{Date} */
    let expires = null;
    let until = '';
    if(token.expires) {
        expires = new Date(token.expires)
        until = ` until ${expires.toLocaleString()}`;
    }
    return [
        (expires && (expires >= new Date())) ?
            `Invitation${foruser}${togroup}${by} valid${since}${until}` :
            `Expired invitation${foruser}${togroup}${by}`,
        url.toString(),
    ];
}

const urlRegexp = /https?:\/\/[-a-zA-Z0-9@:%/._\\+~#&()=?]+[-a-zA-Z0-9@:%/_\\+~#&()=]/g;

/**
 * @param {string} text
 * @returns {HTMLDivElement}
 */
function formatText(text) {
    let r = new RegExp(urlRegexp);
    let result = [];
    let pos = 0;
    while(true) {
        let m = r.exec(text);
        if(!m)
            break;
        result.push(document.createTextNode(text.slice(pos, m.index)));
        let a = document.createElement('a');
        a.href = m[0];
        a.textContent = m[0];
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        result.push(a);
        pos = m.index + m[0].length;
    }
    result.push(document.createTextNode(text.slice(pos)));

    let div = document.createElement('div');
    result.forEach(e => {
        div.appendChild(e);
    });
    return div;
}

/**
 * @param {Date} time
 * @returns {string}
 */
function formatTime(time) {
    let delta = Date.now() - time.getTime();
    let m = time.getMinutes();
    if(delta > -30000)
        return time.getHours() + ':' + ((m < 10) ? '0' : '') + m;
    return time.toLocaleString();
}

/**
 * @typedef {Object} lastMessage
 * @property {string} [nick]
 * @property {string} [peerId]
 * @property {string} [dest]
 * @property {Date} [time]
 */

/** @type {lastMessage} */
let lastMessage = {};

/**
 * @param {string} id
 * @param {string} peerId
 * @param {string} dest
 * @param {string} nick
 * @param {Date} time
 * @param {boolean} privileged
 * @param {boolean} history
 * @param {string} kind
 * @param {string|HTMLElement} message
 */
function addToChatbox(id, peerId, dest, nick, time, privileged, history, kind, message) {
    if(history && (window._spartanNoHist || (window._spartanSince && time && time.getTime() < window._spartanSince))) return;
    if(kind === 'caption') {
        displayCaption(message);
        return;
    }

    let row = document.createElement('div');
    row.classList.add('message-row');
    let container = document.createElement('div');
    container.classList.add('message');
    row.appendChild(container);
    let footer = document.createElement('p');
    footer.classList.add('message-footer');
    if(!peerId)
        container.classList.add('message-system');
    if(serverConnection && peerId === serverConnection.id)
        container.classList.add('message-sender');
    if(dest)
        container.classList.add('message-private');

    if(id)
        container.dataset.id = id;
    if(peerId) {
        container.dataset.peerId = peerId;
        container.dataset.username = nick;
        container.addEventListener('click', function(e) {
            if(e.detail !== 2)
                return;
            let elt = e.currentTarget;
            if(!elt || !(elt instanceof HTMLElement))
                throw new Error("Couldn't find chat message div");
            chatMessageMenu(elt);
        });
    }

    /** @type{HTMLElement} */
    let body;
    if(message instanceof HTMLElement) {
        body = message;
    } else if(typeof message === 'string') {
        body = formatText(message);
    } else {
        throw new Error('Cannot add element to chatbox');
    }

    if(kind !== 'me') {
        let doHeader = true;
        if(lastMessage.nick !== (nick || null) ||
           lastMessage.peerId !== (peerId || null) ||
           lastMessage.dest !== (dest || null) ||
           !time || !lastMessage.time) {
            doHeader = true;
        } else {
            let delta = time.getTime() - lastMessage.time.getTime();
            doHeader = delta < 0 || delta > 60000;
        }

        if(doHeader) {
            let header = document.createElement('p');
            let user = document.createElement('span');
            let u = dest && serverConnection.users[dest];
            let name = (u && u.username);
            user.textContent = dest ?
                `${spartanDisplayName(nick)} \u2192 ${spartanDisplayName(name)}` :
                spartanDisplayName(nick);
            user.classList.add('message-user');
            header.appendChild(user);
            header.classList.add('message-header');
            container.appendChild(header);
            if(time) {
                let tm = document.createElement('span');
                tm.textContent = formatTime(time);
                tm.classList.add('message-time');
                header.appendChild(tm);
            }
        }

        let p = document.createElement('p');
        p.appendChild(body);
        p.classList.add('message-content');
        container.appendChild(p);
        lastMessage.nick = (nick || null);
        lastMessage.peerId = peerId;
        lastMessage.dest = (dest || null);
        lastMessage.time = (time || null);
    } else {
        let asterisk = document.createElement('span');
        asterisk.textContent = '*';
        asterisk.classList.add('message-me-asterisk');
        let user = document.createElement('span');
        user.textContent = nick || '(anônimo)';
        user.classList.add('message-me-user');
        body.classList.add('message-me-content');
        container.appendChild(asterisk);
        container.appendChild(user);
        container.appendChild(body);
        container.classList.add('message-me');
        lastMessage = {};
    }
    container.appendChild(footer);

    let box = document.getElementById('box');
    box.appendChild(row);
    if(box.scrollHeight > box.clientHeight) {
        box.scrollTop = box.scrollHeight - box.clientHeight;
    }

    return;
}

/**
 * @param {HTMLElement} elt
 */
function chatMessageMenu(elt) {
    if(!(serverConnection && serverConnection.permissions &&
         serverConnection.permissions.indexOf('op') >= 0))
        return;

    let messageId = elt.dataset.id;
    let peerId = elt.dataset.peerId;
    if(!peerId)
        return;
    let username = elt.dataset.username;
    let u = username || 'user';

    let items = [];
    if(messageId)
        items.push({label: 'Apagar mensagem', onClick: () => {
            serverConnection.groupAction('clearchat', {
                id: messageId,
                userId: peerId,
            });
        }});
    items.push({label: `Apagar tudo de ${u}`,
                onClick: () => {
                    serverConnection.groupAction('clearchat', {
                        userId: peerId,
                    });
                }});
    items.push({label: `Identificar ${u}`, onClick: () => {
        serverConnection.userAction('identify', peerId);
    }});
    items.push({label: `Expulsar ${u}`, onClick: () => {
        serverConnection.userAction('kick', peerId);
    }});

    /** @ts-ignore */
    new Contextual({
        items: items,
    });
}

/**
 * @param {string|HTMLElement} message
 */
function setCaption(message) {
    let container = document.getElementById('captions-container');
    let captions = document.getElementById('captions');
    if(!message) {
        captions.replaceChildren();
        container.classList.add('invisible');
    } else {
        if(message instanceof HTMLElement)
            captions.replaceChildren(message);
        else
            captions.textContent = message;
        container.classList.remove('invisible');
    }
}

let captionsTimer = null;

/**
 * @param {string|HTMLElement} message
 */
function displayCaption(message) {
    if(captionsTimer !== null) {
        clearTimeout(captionsTimer);
        captionsTimer = null;
    }
    setCaption(message);
    captionsTimer = setTimeout(() => setCaption(null), 3000);
}

/**
 * @param {string|HTMLElement} message
 */
function localMessage(message) {
    return addToChatbox(null, null, null, null, new Date(), false, false, '', message);
}

/**
 * @param {string} [id]
 * @param {string} [userId]
 */
function clearChat(id, userId) {
    lastMessage = {};

    let box = document.getElementById('box');
    if(!id && !userId) {
        box.textContent = '';
        return;
    }

    let elts = box.children;
    let i = 0;
    while(i < elts.length) {
        let row = elts.item(i);
        if(row instanceof HTMLDivElement) {
            let div = row.firstChild;
            if(div instanceof HTMLDivElement)
                if((!id || div.dataset.id === id) &&
                   div.dataset.peerId === userId) {
                    box.removeChild(row);
                    continue;
                }
        }
        i++;
    }
}

/**
 * A command known to the command-line parser.
 *
 * @typedef {Object} command
 * @property {string} [parameters]
 *     - A user-readable list of parameters.
 * @property {string} [description]
 *     - A user-readable description, null if undocumented.
 * @property {() => string} [predicate]
 *     - Returns null if the command is available.
 * @property {(c: string, r: string) => void} f
 */

/**
 * The set of commands known to the command-line parser.
 *
 * @type {Object.<string,command>}
 */
let commands = {};

function operatorPredicate() {
    if(serverConnection && serverConnection.permissions &&
       serverConnection.permissions.indexOf('op') >= 0)
        return null;
    return 'Você não é admin desta sala';
}

function recordingPredicate() {
    if(serverConnection && serverConnection.permissions &&
       serverConnection.permissions.indexOf('record') >= 0)
        return null;
    return 'Você não pode gravar';
}

commands.help = {
    description: 'mostrar esta ajuda',
    f: (c, r) => {
        /** @type {string[]} */
        let cs = [];
        for(let cmd in commands) {
            let c = commands[cmd];
            if(!c.description)
                continue;
            if(c.predicate && c.predicate())
                continue;
            cs.push(`/${cmd}${c.parameters?' ' + c.parameters:''}: ${c.description}`);
        }
        localMessage(cs.sort().join('\n'));
    }
};

commands.me = {
    f: (c, r) => {
        // handled as a special case
        throw new Error("this shouldn't happen");
    }
};

commands.set = {
    f: (c, r) => {
        if(!r) {
            let settings = getSettings();
            let s = "";
            for(let key in settings)
                s = s + `${key}: ${JSON.stringify(settings[key])}\n`;
            localMessage(s);
            return;
        }
        let p = parseCommand(r);
        let value;
        if(p[1]) {
            value = JSON.parse(p[1]);
        } else {
            value = true;
        }
        updateSetting(p[0], value);
        reflectSettings();
    }
};

commands.unset = {
    f: (c, r) => {
        delSetting(r.trim());
        return;
    }
};

commands.leave = {
    description: "sair da sala",
    f: (c, r) => {
        if(!serverConnection)
            throw new Error('Sem conexão');
        serverConnection.close();
    }
};

commands.clear = {
    predicate: operatorPredicate,
    description: 'limpar o histórico do chat',
    f: (c, r) => {
        serverConnection.groupAction('clearchat');
    }
};

commands.lock = {
    predicate: operatorPredicate,
    description: 'trancar a sala',
    parameters: '[message]',
    f: (c, r) => {
        serverConnection.groupAction('lock', r);
    }
};

commands.unlock = {
    predicate: operatorPredicate,
    description: 'untrancar a sala, revert the effect of /lock',
    f: (c, r) => {
        serverConnection.groupAction('unlock');
    }
};

commands.record = {
    predicate: recordingPredicate,
    description: 'começar gravação',
    f: (c, r) => {
        serverConnection.groupAction('record');
    }
};

commands.unrecord = {
    predicate: recordingPredicate,
    description: 'parar gravação',
    f: (c, r) => {
        serverConnection.groupAction('unrecord');
    }
};

commands.subgroups = {
    predicate: operatorPredicate,
    description: 'listar subsalas',
    f: (c, r) => {
        serverConnection.groupAction('subgroups');
    }
};

/**
 * @type {Record<string,number>}
 */
const units = {
    s: 1000,
    min: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    mon: 31 * 24 * 60 * 60 * 1000,
    yr: 365 * 24 * 60 * 60 * 1000,
};

/**
 * @param {string} s
 * @returns {Date|number}
 */
function parseExpiration(s) {
    if(!s)
        return null;
    let re = /^([0-9]+)(s|min|h|d|mon|yr)$/
    let e = re.exec(s)
    if(e) {
        let unit = units[e[2]];
        if(!unit)
            throw new Error(`Couldn't find unit ${e[2]}`);
        return parseInt(e[1]) * unit;
    }
    let d = new Date(s);
    if(d.toString() === 'Invalid Date')
        throw new Error("Couldn't parse expiration date");
    return d;
}

function makeTokenPredicate() {
    return (serverConnection.permissions.indexOf('token') < 0 ?
            "Você não pode criar convites" : null);
}

function editTokenPredicate() {
    return (serverConnection.permissions.indexOf('token') < 0 ||
            serverConnection.permissions.indexOf('op') < 0 ?
            "Você não pode editar convites" : null);
}

/**
 * @param {Object} [template]
 */
function makeToken(template) {
    if(!template)
        template = {};
    let v = {
        group: group,
    }
    if('username' in template)
        v.username = template.username;
    if('expires' in template)
        v.expires = template.expires;
    else
        v.expires = units.d;
    if('not-before' in template)
        v["not-before"] = template["not-before"];
    if('permissions' in template)
        v.permissions = template.permissions;
    else {
        v.permissions = [];
        if(serverConnection.permissions.indexOf('present') >= 0)
            v.permissions.push('present');
        if(serverConnection.permissions.indexOf('message') >= 0)
            v.permissions.push('message');
    }
    serverConnection.groupAction('maketoken', v);
}

commands.invite = {
    predicate: makeTokenPredicate,
    description: "criar link de convite",
    parameters: "[username] [expiration]",
    f: (c, r) => {
        let p = parseCommand(r);
        let template = {};
        if(p[0])
            template.username = p[0];
        let expires = parseExpiration(p[1]);
        if(expires)
            template.expires = expires;
        makeToken(template);
    }
}

/**
 * @param {string} t
 */
function parseToken(t) {
    let m = /^https?:\/\/.*?token=([^?]+)/.exec(t);
    if(m) {
        return m[1];
    } else if(!/^https?:\/\//.exec(t)) {
        return t
    } else {
        throw new Error("Couldn't parse link");
    }
}

commands.reinvite = {
    predicate: editTokenPredicate,
    description: "estender convite",
    parameters: "link [expiration]",
    f: (c, r) => {
        let p = parseCommand(r);
        let v = {}
        v.token = parseToken(p[0]);
        if(p[1])
            v.expires = parseExpiration(p[1]);
        else
            v.expires = units.d;
        serverConnection.groupAction('edittoken', v);
    }
}

commands.revoke = {
    predicate: editTokenPredicate,
    description: "revogar convite",
    parameters: "link",
    f: (c, r) => {
        let token = parseToken(r);
        serverConnection.groupAction('edittoken', {
            token: token,
            expires: -units.s,
        });
    }
}

commands.listtokens = {
    predicate: editTokenPredicate,
    description: "listar convites",
    f: (c, r) => {
        serverConnection.groupAction('listtokens');
    }
}

function renegotiateStreams() {
    for(let id in serverConnection.up)
        serverConnection.up[id].restartIce();
    for(let id in serverConnection.down)
        serverConnection.down[id].restartIce();
}

commands.renegotiate = {
    description: 'reiniciar mídia',
    f: (c, r) => {
        renegotiateStreams();
    }
};

commands.replace = {
    f: (c, r) => {
        replaceUpStreams(null);
    }
};

commands.sharescreen = {
    description: 'compartilhar tela',
    f: (c, r) => {
        addShareMedia();
    }
}

commands.unsharescreen = {
    description: 'parar compartilhamento',
    f: (c, r) => {
        closeUpMedia('screenshare');
    }
}

/**
 * parseCommand splits a string into two space-separated parts.  The first
 * part may be quoted and may include backslash escapes.
 *
 * @param {string} line
 * @returns {string[]}
 */
function parseCommand(line) {
    let i = 0;
    while(i < line.length && line[i] === ' ')
        i++;
    let start = ' ';
    if(i < line.length && (line[i] === '"' || line[i] === "'")) {
        start = line[i];
        i++;
    }
    let first = "";
    while(i < line.length) {
        if(line[i] === start) {
            if(start !== ' ')
                i++;
            break;
        }
        if(line[i] === '\\' && i < line.length - 1)
            i++;
        first = first + line[i];
        i++;
    }

    while(i < line.length && line[i] === ' ')
        i++;
    return [first, line.slice(i)];
}

/**
 * @param {string} user
 */
function findUserId(user) {
    if(user in serverConnection.users)
        return user;

    for(let id in serverConnection.users) {
        let u = serverConnection.users[id];
        if(u && u.username === user)
            return id;
    }
    return null;
}

commands.msg = {
    parameters: 'user message',
    description: 'enviar mensagem privada',
    f: (c, r) => {
        let p = parseCommand(r);
        if(!p[0])
            throw new Error('/msg precisa de parâmetros');
        let id = findUserId(p[0]);
        if(!id)
            throw new Error(`Usuário desconhecido: ${p[0]}`);
        serverConnection.chat('', id, p[1]);
        addToChatbox(serverConnection.id, null, id, serverConnection.username,
                     new Date(), false, false, '', p[1]);
    }
};

/**
   @param {string} c
   @param {string} r
*/
function userCommand(c, r) {
    let p = parseCommand(r);
    if(!p[0])
        throw new Error(`/${c} requires parameters`);
    let id = findUserId(p[0]);
    if(!id)
            throw new Error(`Usuário desconhecido: ${p[0]}`);
    serverConnection.userAction(c, id, p[1]);
}

function userMessage(c, r) {
    let p = parseCommand(r);
    if(!p[0])
        throw new Error(`/${c} requires parameters`);
    let id = findUserId(p[0]);
    if(!id)
            throw new Error(`Usuário desconhecido: ${p[0]}`);
    serverConnection.userMessage(c, id, p[1]);
}

commands.kick = {
    parameters: 'user [message]',
    description: 'expulsar usuário',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.identify = {
    parameters: 'user [message]',
    description: 'identificar usuário',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.op = {
    parameters: 'user',
    description: 'dar admin',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.unop = {
    parameters: 'user',
    description: 'tirar admin',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.present = {
    parameters: 'user',
    description: 'liberar transmissão',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.unpresent = {
    parameters: 'user',
    description: 'tirar transmissão',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.shutup = {
    parameters: 'user',
    description: 'calar o chat',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.unshutup = {
    parameters: 'user',
    description: 'liberar o chat',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.mute = {
    parameters: 'user',
    description: 'silenciar alguém',
    predicate: operatorPredicate,
    f: userMessage,
};

commands.muteall = {
    description: 'silenciar todos',
    predicate: operatorPredicate,
    f: (c, r) => {
        serverConnection.userMessage('mute', null, null, true);
    }
}

commands.warn = {
    parameters: 'user message',
    description: 'avisar alguém',
    predicate: operatorPredicate,
    f: (c, r) => {
        userMessage('warning', r);
    },
};

commands.wall = {
    parameters: 'message',
    description: 'avisar todos',
    predicate: operatorPredicate,
    f: (c, r) => {
        if(!r)
            throw new Error('mensagem vazia');
        serverConnection.userMessage('warning', '', r);
    },
};

commands.raise = {
    description: 'levantar a mão',
    f: (c, r) => {
        serverConnection.userAction(
            "setdata", serverConnection.id, {"raisehand": true},
        );
    }
}

commands.unraise = {
    description: 'unlevantar a mão',
    f: (c, r) => {
        serverConnection.userAction(
            "setdata", serverConnection.id, {"raisehand": null},
        );
    }
}

/** @returns {boolean} */
function canFile() {
    let v =
        /** @ts-ignore */
        !!HTMLVideoElement.prototype.captureStream ||
        /** @ts-ignore */
        !!HTMLVideoElement.prototype.mozCaptureStream;
    return v;
}

function presentFile() {
    let input = document.createElement('input');
    input.type = 'file';
    input.accept="audio/*,video/*";
    input.onchange = function(e) {
        if(!(this instanceof HTMLInputElement))
            throw new Error('Unexpected type for this');
        let files = this.files;
        for(let i = 0; i < files.length; i++) {
            addFileMedia(files[i]).catch(e => {
                console.error(e);
                displayError(e);
            });
        }
    };
    input.click();
}

commands.presentfile = {
    description: 'transmitir arquivo de vídeo ou áudio',
    f: (c, r) => {
        presentFile();
    },
    predicate: () => {
        if(!canFile())
            return 'Este navegador não transmite arquivo';
        if(!serverConnection || !serverConnection.permissions ||
           serverConnection.permissions.indexOf('present') < 0)
            return 'Você não pode transmitir.';
        return null;
    }
};


/**
 * @param {string} id
 */
function sendFile(id) {
    let input = document.createElement('input');
    input.type = 'file';
    input.onchange = function(e) {
        if(!(this instanceof HTMLInputElement))
            throw new Error('Unexpected type for this');
        let files = this.files;
        for(let i = 0; i < files.length; i++) {
            try {
                serverConnection.sendFile(id, files[i]);
            } catch(e) {
                console.error(e);
                displayError(e);
            }
        }
    };
    input.click();
}

commands.sendfile = {
    parameters: 'user',
    description: 'enviar arquivo (mostra o seu IP)',
    f: (c, r) => {
        let p = parseCommand(r);
        if(!p[0])
            throw new Error(`/${c} requires parameters`);
        let id = findUserId(p[0]);
        if(!id)
            throw new Error(`Usuário desconhecido: ${p[0]}`);
        sendFile(id);
    },
};

/**
 * Test loopback through a TURN relay.
 *
 * @returns {Promise<number>}
 */
async function relayTest() {
    if(!serverConnection)
        throw new Error('sem conexão');
    let conf = Object.assign({}, serverConnection.getRTCConfiguration());
    conf.iceTransportPolicy = 'relay';
    let pc1 = new RTCPeerConnection(conf);
    let pc2 = new RTCPeerConnection(conf);
    pc1.onicecandidate = e => {e.candidate && pc2.addIceCandidate(e.candidate);};
    pc2.onicecandidate = e => {e.candidate && pc1.addIceCandidate(e.candidate);};
    try {
        return await new Promise(async (resolve, reject) => {
            let d1 = pc1.createDataChannel('loopbackTest');
            d1.onopen = e => {
                d1.send(Date.now().toString());
            };

            let offer = await pc1.createOffer();
            await pc1.setLocalDescription(offer);
            await pc2.setRemoteDescription(pc1.localDescription);
            let answer = await pc2.createAnswer();
            await pc2.setLocalDescription(answer);
            await pc1.setRemoteDescription(pc2.localDescription);

            pc2.ondatachannel = e => {
                let d2 = e.channel;
                d2.onmessage = e => {
                    let t = parseInt(e.data);
                    if(isNaN(t))
                        reject(new Error('corrupt data'));
                    else
                        resolve(Date.now() - t);
                }
            }

            setTimeout(() => reject(new Error('timeout')), 5000);
        })
    } finally {
        pc1.close();
        pc2.close();
    }
}

commands['relay-test'] = {
    f: async (c, r) => {
        localMessage('Relay test in progress...');
        try {
            let s = Date.now();
            let rtt = await relayTest();
            let e = Date.now();
            localMessage(`Relay test successful in ${e-s}ms, RTT ${rtt}ms`);
        } catch(e) {
            localMessage(`Relay test failed: ${e}`);
        }
    }
}

function handleInput() {
    let input = /** @type {HTMLTextAreaElement} */
        (document.getElementById('input'));
    let data = input.value;
    input.value = '';

    let message, me;

    if(data === '')
        return;

    if(data[0] === '/') {
        if(data.length > 1 && data[1] === '/') {
            message = data.slice(1);
            me = false;
        } else {
            let cmd, rest;
            let space = data.indexOf(' ');
            if(space < 0) {
                cmd = data.slice(1);
                rest = '';
            } else {
                cmd = data.slice(1, space);
                rest = data.slice(space + 1);
            }

            if(cmd === 'me') {
                message = rest;
                me = true;
            } else {
                let c = commands[cmd];
                if(!c) {
                    displayError(
                        `Comando /${cmd} desconhecido, digite /help`
                    );
                    return;
                }
                if(c.predicate) {
                    let s = c.predicate();
                    if(s) {
                        displayError(s);
                        return;
                    }
                }
                try {
                    c.f(cmd, rest);
                } catch(e) {
                    console.error(e);
                    displayError(e);
                }
                return;
            }
        }
    } else {
        message = data;
        me = false;
    }

    if(!serverConnection || !serverConnection.socket) {
        displayError("Sem conexão.");
        return;
    }

    try {
        serverConnection.chat(me ? 'me' : '', '', message);
    } catch(e) {
        console.error(e);
        displayError(e);
    }
}

document.getElementById('inputform').onsubmit = function(e) {
    e.preventDefault();
    handleInput();
};

document.getElementById('input').onkeypress = function(e) {
    if(e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        handleInput();
    }
};

function chatResizer(e) {
    e.preventDefault();
    let full_width = document.getElementById("mainrow").offsetWidth;
    let left = document.getElementById("left");
    let right = document.getElementById("right");

    let start_x = e.clientX;
    let start_width = left.offsetWidth;

    function start_drag(e) {
        let left_width = (start_width + e.clientX - start_x) * 100 / full_width;
        // set min chat width to 300px
        let min_left_width = 300 * 100 / full_width;
        if (left_width < min_left_width) {
          return;
        }
        left.style.flex = left_width.toString();
        right.style.flex = (100 - left_width).toString();
    }
    function stop_drag(e) {
        document.documentElement.removeEventListener(
            'mousemove', start_drag, false,
        );
        document.documentElement.removeEventListener(
            'mouseup', stop_drag, false,
        );
    }

    document.documentElement.addEventListener(
        'mousemove', start_drag, false,
    );
    document.documentElement.addEventListener(
        'mouseup', stop_drag, false,
    );
}

document.getElementById('resizer').addEventListener('mousedown', chatResizer, false);

/**
 * @param {unknown} message
 * @param {string} [level]
 */
function spartanErr(message){
 if(message instanceof Error){
  let n=message.name||'';
  let m=message.message||String(message);
  if(n==='NotFoundError' || /Requested device not found/i.test(m))
   return 'Microfone ou câmera não encontrados. Confere se estão conectados e liberados no sistema.';
  if(n==='NotAllowedError' || /Permission denied|NotAllowedError/i.test(m))
   return 'Permissão negada. Libera o microfone/câmera neste site nas configurações do navegador.';
  if(n==='NotReadableError' || /Could not start|NotReadableError/i.test(m))
   return 'Não deu para usar o dispositivo. Fecha outros apps que estejam usando o microfone ou a câmera.';
  if(n==='OverconstrainedError')
   return 'Este dispositivo não bate com as opções escolhidas. Tenta outro microfone/câmera em Configurações.';
  if(n==='AbortError')
   return 'Pedido de mídia cancelado.';
  if(n==='SecurityError')
   return 'O navegador bloqueou a mídia por segurança (precisa HTTPS).';
  if(/At least one of audio and video must be requested/i.test(m))
   return 'Precisa pedir microfone ou câmera. Tenta de novo pelo botão Microfone ou Câmera.';
  if(/getUserMedia/i.test(m))
   return 'Não deu para acessar microfone/câmera. Confere permissões e se o dispositivo existe.';
  message=m;
 }
 let s=String(message==null?'':message);
 const pairs=[
  ['not authorised','sem permissão para entrar. Confere o nick e a senha.'],
  ['not authorized','sem permissão para entrar. Confere o nick e a senha.'],
  ['need-username','digite um nome de usuário'],
  ['failed to join','não deu para entrar na sala'],
  ['permission denied','permissão negada'],
  ['bad password','senha incorreta'],
  ['Requested device not found','Microfone ou câmera não encontrados'],
  ['Could not start video source','Não deu para iniciar a câmera'],
  ['Could not start audio source','Não deu para iniciar o microfone'],
  ['Your browser does not support screen sharing','Este navegador não compartilha tela'],
  ['Screen sharing in Safari is broken','No Safari a partilha de tela falha depois de um tempo'],
 ];
 for(const [en,pt] of pairs){ if(s.toLowerCase().indexOf(en.toLowerCase())>=0) return pt; }
 return s;
}
function displayError(message, level) {
    message = spartanErr(message);
    if(level==='kicked' || /not authorised|sem permissão|bad password|senha incorreta/i.test(String(message))){ try{ sessionStorage.removeItem('spartanSession:'+group); sessionStorage.removeItem('spartanSession'); sessionStorage.removeItem('spartanPending'); }catch(e){} window._spartanCred=''; }
    if(!level)
        level = "error";
    let position = 'center';
    let gravity = 'top';

    switch(level) {
    case "info":
        position = 'right';
        gravity = 'bottom';
        break;
    case "warning":
        break;
    case "kicked":
        level = "error";
        break;
    }

    /** @ts-ignore */
    Toastify({
        text: message,
        duration: 4000,
        close: true,
        position: position,
        gravity: gravity,
        className: level,
    }).showToast();
}

/**
 * @param {unknown} message
 */
function displayWarning(message) {
    return displayError(message, "warning");
}

/**
 * @param {unknown} message
 */
function displayMessage(message) {
    return displayError(message, "info");
}

document.getElementById('loginform').onsubmit = async function(e) {
    e.preventDefault();

    let form = this;
    if(!(form instanceof HTMLFormElement))
        throw new Error('Bad type for loginform');

    setVisibility('passwordform', true);

    if(getInputElement('presentboth').checked)
        presentRequested = 'both';
    else if(getInputElement('presentmike').checked)
        presentRequested = 'mike';
    else
        presentRequested = null;
    getInputElement('presentoff').checked = true;

    const _u=getInputElement('username').value.trim();
    await spartanHistFlags(_u);
    try{
      const ts=await (await fetch('/spartan-api/temp-status?group='+encodeURIComponent(group)+'&user='+encodeURIComponent(_u))).json();
      if(ts.banned){ displayError('Este IP está suspenso nesta sala por 24 horas.'); return; }
      if(ts.open && ts.taken){ displayError('Esse nick já é de uma conta ou convite. Escolhe outro.'); return; }
      if(ts.open) window._spartanOpenRoom=true;
      window._spartanPurge=ts.purge;
    }catch(e){}
    serverConnect();
};

document.getElementById('disconnectbutton').onclick = function(e) {
    try{sessionStorage.removeItem('spartanAdmin');sessionStorage.removeItem('spartanPending');sessionStorage.removeItem('spartanSession');sessionStorage.setItem('spartanLoggedOut','1');Object.keys(sessionStorage).forEach(function(k){if(k.indexOf('spartanSession:')===0)sessionStorage.removeItem(k);});window._spartanCred='';}catch(e){}
    location.href='/';
};

document.getElementById('sidebarCollapse').onclick = function(e) {
    document.getElementById("left-sidebar").classList.toggle("active");
    document.getElementById("mainrow").classList.toggle("full-width-active");
};

document.getElementById('openside').onclick = function(e) {
      e.preventDefault();
      let nav = document.getElementById('sidebarnav');
      if(nav.classList.contains('spartan-settings-open'))
          closeNav();
      else
          openNav();
};

document.getElementById('sidebarnav').addEventListener('click', function(e) {
    if(e.target === this)
        closeNav();
});

let chatEl = document.getElementById('chat');
if(chatEl) {
    chatEl.addEventListener('click', function(e) {
        if(e.target === this)
            spartanSetChatOpen(false);
    });
}

document.getElementById('clodeside').onclick = function(e) {
    e.preventDefault();
    closeNav();
};

let hideOwnBtn = document.getElementById('hideownbutton');
if(hideOwnBtn) {
    hideOwnBtn.onclick = function(e) {
        e.preventDefault();
        spartanHideOwn = !spartanHideOwn;
        spartanRefreshAllMedia();
    };
}

let chatBtn = document.getElementById('channel-chat-btn');
if(chatBtn) {
    chatBtn.onclick = function(e) {
        e.preventDefault();
        let chat = document.getElementById('chat');
        spartanSetChatOpen(!(chat && chat.classList.contains('spartan-chat-open')));
    };
}

document.getElementById('collapse-video').onclick = function(e) {
    e.preventDefault();
    setVisibility('collapse-video', false);
    setVisibility('show-video', true);
    hideVideo(true);
};

document.getElementById('show-video').onclick = function(e) {
    e.preventDefault();
    setVisibility('video-container', true);
    setVisibility('collapse-video', true);
    setVisibility('show-video', false);
};

document.getElementById('close-chat').onclick = function(e) {
    e.preventDefault();
    spartanSetChatOpen(false);
};

document.getElementById('show-chat').onclick = function(e) {
    e.preventDefault();
    spartanSetChatOpen(true);
};

async function serverConnect() {
    if(serverConnection && serverConnection.socket)
        serverConnection.close();
    serverConnection = new ServerConnection();
    serverConnection.onconnected = gotConnected;
    serverConnection.onerror = function(e) {
        console.error(e);
        displayError(e);
    };
    serverConnection.onpeerconnection = onPeerConnection;
    serverConnection.onclose = gotClose;
    serverConnection.ondownstream = gotDownStream;
    serverConnection.onuser = gotUser;
    serverConnection.onjoined = gotJoined;
    serverConnection.onchat = addToChatbox;
    serverConnection.onusermessage = gotUserMessage;
    serverConnection.onfiletransfer = gotFileTransfer;

    let url = groupStatus.endpoint;
    if(!url) {
        console.warn("no endpoint in status");
        url = `ws${location.protocol === 'https:' ? 's' : ''}://${location.host}/ws`;
    }

    try {
        await serverConnection.connect(url);
    } catch(e) {
        console.error(e);
        displayError(`Não conectou em ${url}: ${e.message}`);
    }
}

async function start() {
    try {
        let r = await fetch(".status")
        if(!r.ok)
            throw new Error(`${r.status} ${r.statusText}`);
        groupStatus = await r.json()
    } catch(e) {
        console.error(e);
        displayWarning("Não deu para buscar o status: " + e);
        groupStatus = {};
    }

    if(groupStatus.name) {
        group = groupStatus.name;
    } else {
        console.warn("no group name in status");
        group = decodeURIComponent(
            location.pathname.replace(/^\/[a-z]*\//, '').replace(/\/$/, ''),
        );
    }

    // Disable simulcast on Firefox by default, it's buggy.
    if(isFirefox())
        getSelectElement('simulcastselect').value = 'off';

    let parms = new URLSearchParams(window.location.search);
    if(window.location.search)
        window.history.replaceState(null, '', window.location.pathname);
    setTitle(groupStatus.displayName || capitalise(group));

    addFilters();
    await setMediaChoices(false);
    reflectSettings();

    if(parms.has('token'))
        token = parms.get('token');

    if(token) {
        await serverConnect();
    } else if(groupStatus.authPortal) {
        window.location.href = groupStatus.authPortal;
    } else {
        setVisibility('login-container', true);
        await spartanPrepareOpenRoom();
        try{
          var _nav=(performance.getEntriesByType&&performance.getEntriesByType('navigation')[0]||{}).type;
          var s=JSON.parse(sessionStorage.getItem('spartanSession:'+group)||'null');
          if(s&&s.pass&&!sessionStorage.getItem('spartanLoggedOut')&&(!s.group||s.group===group)){
            window._spartanCred=s.pass;
            getInputElement('username').value=s.user||'';
            getInputElement('password').value='';
            await spartanHistFlags(s.user||'');
            serverConnect();
            return;
          }
        }catch(e){}
        document.getElementById('username').focus()
    }
    setViewportHeight();
}

start();

function spartanOnJoin(){
 try{
  const u=serverConnection&&serverConnection.username; if(!u) return;
  fetch('/spartan-api/beacon',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({group:group,user:u})}).catch(function(){});
  spartanMaybeFirstSetup(u);
  const p=serverConnection.permissions||[];
  if(p.indexOf('op')>=0||p.indexOf('admin')>=0) return;
  spartanCheck(u);
  if(!window._spartanPoll) window._spartanPoll=setInterval(function(){spartanCheck(serverConnection&&serverConnection.username);},4000);
 }catch(e){}
}
async function spartanMaybeFirstSetup(u){
 try{
  const r=await fetch('/spartan-api/must-change?user='+encodeURIComponent(u),{cache:'no-store'});
  const j=await r.json();
  if(!j||!j.must_change) return;
  const modal=document.getElementById('spartan-first-modal');
  if(!modal) return;
  modal.hidden=false;
  const ok=document.getElementById('spartan-first-ok');
  if(!ok||ok.dataset.bound) return;
  ok.dataset.bound='1';
  ok.onclick=async function(){
   const err=document.getElementById('spartan-first-err');
   const a=document.getElementById('spartan-first-admin').value;
   const f=document.getElementById('spartan-first-friends').value;
   err.textContent='';
   if(!a||a.length<8||!f||f.length<8){ err.textContent='Mínimo 8 caracteres em cada senha.'; return; }
   if(a==='Mudar@123'||f==='Mudar@123'){ err.textContent='Não use a senha de fábrica.'; return; }
   let old='';
   try{
    const s=JSON.parse(sessionStorage.getItem('spartanSession:'+group)||'null');
    old=(s&&s.pass)||window._spartanCred||'';
   }catch(e){}
   if(!old){ err.textContent='Sessão sem senha. Saia e entre de novo com Mudar@123.'; return; }
   try{
    const rr=await fetch('/spartan-api/first-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:u,old:old,admin_password:a,friends_password:f})});
    const jj=await rr.json();
    if(!rr.ok) throw new Error((jj&&jj.error)||'falhou');
    try{
     const hand={user:String(u).toLowerCase(),pass:a};
     sessionStorage.setItem('spartanSession:'+group,JSON.stringify({user:u,pass:a,group:group}));
     sessionStorage.setItem('spartanAdmin',JSON.stringify(hand));
     localStorage.setItem('spartanAdminHandoff',JSON.stringify(hand));
    }catch(e){}
    modal.hidden=true;
    spartanToast('Senhas atualizadas. Guarde as novas senhas.');
   }catch(e){ err.textContent=e.message||String(e); }
  };
 }catch(e){}
}
async function spartanCheck(u){
 if(!u) return;
 try{
  let j={};
  try{ const r=await fetch('/spartan-api/status?group='+encodeURIComponent(group)+'&user='+encodeURIComponent(u)); j=await r.json(); }catch(e){}
  if(window._spartanOpenRoom){
    try{ const t=await (await fetch('/spartan-api/temp-status?group='+encodeURIComponent(group)+'&user='+encodeURIComponent(u))).json(); Object.assign(j,t); }catch(e){}
  }

  if(j.banned){ spartanToast('IP suspenso nesta sala por 24h.'); location.href='/'; return; }
  if(window._spartanOpenRoom && j.purge!=null){
    if(window._spartanPurge!=null && j.purge!==window._spartanPurge){
      if(typeof clearChat==='function') try{clearChat();}catch(e){}
      location.href='/?cleared=1'; return;
    }
    window._spartanPurge=j.purge;
  }
  if(j.status==='denied'||j.status==='blocked'){ spartanToast('Seu acesso foi bloqueado.'); location.href='/'; return; }
  const btn=document.getElementById('spartan-reg-btn'); if(!btn) return;
  btn.hidden=!(j.status==='guest' && !window._spartanOpenRoom);
 }catch(e){}
}
function spartanBind(){
 const btn=document.getElementById('spartan-reg-btn'), modal=document.getElementById('spartan-reg-modal');
 if(!btn||btn.dataset.bound) return; btn.dataset.bound='1';
 btn.onclick=function(){ modal.hidden=false; };
 document.getElementById('spartan-reg-cancel').onclick=function(){ modal.hidden=true; };
 document.getElementById('spartan-reg-ok').onclick=async function(){
  const pw=document.getElementById('spartan-reg-pw').value, err=document.getElementById('spartan-reg-err');
  err.textContent='';
  if(!pw||pw.length<8){ err.textContent='Mínimo 8 caracteres.'; return; }
  try{
   const r=await fetch('/spartan-api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({group:group,user:serverConnection.username,password:pw})});
   const j=await r.json();
   if(!r.ok) throw new Error(j.error||'falhou');
   modal.hidden=true; document.getElementById('spartan-reg-btn').hidden=true;
   spartanToast('Pedido enviado. Espera um admin aprovar.');
  }catch(e){ err.textContent=e.message; }
 };
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', spartanBind);
else spartanBind();

function spartanToast(m){
 var t=document.getElementById('spartan-toast'); if(!t) return;
 t.textContent=m; t.hidden=false;
 clearTimeout(window._spartanToast); window._spartanToast=setTimeout(function(){t.hidden=true;},3500);
}
function spartanAsk(msg, kind){
 return new Promise(function(resolve){
  var dlg=document.getElementById('spartan-dlg'), input=document.getElementById('spartan-dlg-input');
  var cancel=document.getElementById('spartan-dlg-cancel');
  if(!dlg){ resolve(kind==='prompt'?null:false); return; }
  document.getElementById('spartan-dlg-msg').textContent=msg;
  input.hidden = kind!=='prompt'; input.value='';
  cancel.hidden = kind==='ok';
  dlg.hidden=false;
  document.getElementById('spartan-dlg-ok').onclick=function(){ dlg.hidden=true; resolve(kind==='prompt'?input.value:true); };
  cancel.onclick=function(){ dlg.hidden=true; resolve(kind==='prompt'?null:false); };
 });
}

async function spartanHistFlags(uname){
 window._spartanNoHist=true; window._spartanSince=0;
 if(!uname) return;
 try{
  const r=await fetch('/spartan-api/status?group='+encodeURIComponent(group)+'&user='+encodeURIComponent(uname));
  const j=await r.json();
  if(j.status==='guest'||j.status==='pending'){ window._spartanNoHist=true; return; }
  if(j.created){ window._spartanNoHist=false; window._spartanSince=Date.parse(j.created)||0; return; }
  window._spartanNoHist=false;
 }catch(e){}
}

async function spartanPrepareOpenRoom(){
 try{
  const list=await (await fetch('/spartan-api/rooms')).json();
  const me=(list||[]).find(function(x){return x.id===group;});
  if(me&&me.open){
   window._spartanOpenRoom=true;
   setVisibility('passwordform', false);
   var lab=document.querySelector('#passwordform');
   if(lab) lab.classList.add('invisible');
  }
 }catch(e){}
}
