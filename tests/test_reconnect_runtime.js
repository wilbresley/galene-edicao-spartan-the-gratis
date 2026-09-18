#!/usr/bin/env node
"use strict";
/**
 * Runtime: handshake/join, assinatura direcionada e snapshot antes do close.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const protoSrc = fs.readFileSync(path.join(root, "static", "protocol.js"), "utf8");

class FakeWebSocket {
    constructor(url) {
        this.url = url;
        this.CONNECTING = 0;
        this.OPEN = 1;
        this.CLOSING = 2;
        this.CLOSED = 3;
        this.readyState = this.OPEN;
        this.sent = [];
        const self = this;
        setImmediate(function() {
            if(self.readyState === self.OPEN && self.onopen)
                self.onopen({});
        });
    }
    send(raw) {
        this.sent.push(JSON.parse(raw));
    }
    close(code, reason) {
        this.readyState = FakeWebSocket.CLOSED;
        if(this.onclose)
            this.onclose({code: code || 1006, reason: reason || ""});
    }
}
FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSING = 2;
FakeWebSocket.CLOSED = 3;

class FakePC {
    constructor() {
        this.closed = false;
    }
    close() {
        this.closed = true;
    }
    getTransceivers() { return []; }
    getSenders() { return []; }
    getReceivers() { return []; }
    addTrack() { return { track: null }; }
    createOffer() { return Promise.resolve({type: "offer", sdp: ""}); }
    createAnswer() { return Promise.resolve({type: "answer", sdp: ""}); }
    setLocalDescription() { return Promise.resolve(); }
    setRemoteDescription() { return Promise.resolve(); }
    addIceCandidate() { return Promise.resolve(); }
}

class FakeTrack {
    constructor(kind) {
        this.kind = kind;
        this.readyState = "live";
        this.enabled = true;
        this.stopped = false;
        this.id = kind + "-t";
    }
    stop() {
        this.stopped = true;
        this.readyState = "ended";
    }
}

const sandbox = {
    console: console,
    setInterval: setInterval,
    clearInterval: clearInterval,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setImmediate: setImmediate,
    WebSocket: FakeWebSocket,
    RTCPeerConnection: FakePC,
    RTCSessionDescription: function() {},
    RTCIceCandidate: function() {},
    Date: Date,
    JSON: JSON,
    Error: Error,
    Array: Array,
    Object: Object,
    Promise: Promise,
    parseInt: parseInt,
    crypto: require("crypto"),
};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(protoSrc, sandbox, {filename: "protocol.js"});

function fail(msg) {
    console.error("FAIL:", msg);
    process.exit(1);
}

function ok(cond, msg) {
    if(!cond)
        fail(msg);
}

async function main() {
    const sc = new sandbox.ServerConnection();
    ok(typeof sc.connect === "function", "connect existe");
    ok(typeof sc.requestStreamById === "function", "requestStreamById existe");
    ok(typeof sc.hasCapability === "function", "hasCapability existe");

    let before = false;
    let after = false;
    let keysAtBefore = [];
    const track = new FakeTrack("video");

    const p = sc.connect("ws://lab/ws");
    ok(p && typeof p.then === "function", "connect retorna Promise");
    await new Promise(function(r) { setImmediate(r); });
    const hs = sc.socket.sent.find(function(m) { return m.type === "handshake"; });
    ok(hs, "enviou handshake");
    ok(hs.capabilities && hs.capabilities.indexOf("spartan-request-by-id-v1") >= 0, "cliente anuncia capacidade");

    sc.socket.onmessage({
        data: JSON.stringify({
            type: "handshake",
            version: ["2"],
            capabilities: ["spartan-request-by-id-v1"],
        }),
    });
    await p;
    ok(sc.hasCapability("spartan-request-by-id-v1"), "servidor anunciou capacidade");

    const stream = {
        id: "s1",
        up: true,
        sc: sc,
        pc: new FakePC(),
        stream: {getTracks: function() { return [track]; }, getVideoTracks: function() { return [track]; }, getAudioTracks: function() { return []; }},
        label: "screenshare",
        localDescriptionSent: true,
        statsHandler: null,
        userdata: {},
        onclose: function() { track.stop(); },
        close: function(replace, preserveTracks) {
            if(this.pc)
                this.pc.close();
            if(this.sc && this.sc.up)
                delete this.sc.up[this.id];
            if(this.onclose && !preserveTracks)
                this.onclose.call(this, replace);
            this.sc = null;
        },
    };
    sc.up["s1"] = stream;
    sandbox._upSc = sc;
    sandbox._upStream = stream;
    vm.runInContext('_upSc.up["s1"] = _upStream;', sandbox);
    ok(sc.up["s1"] === stream, "stream anexada no up");
    sc.onbeforeclose = function() {
        before = true;
        ok(!after, "onbeforeclose deve vir antes do onclose");
        keysAtBefore = Object.keys(this.up || {});
        return true;
    };
    sc.onclose = function() {
        after = true;
    };

    const oldGen = sc;
    const sc2 = new sandbox.ServerConnection();
    sc2._gen = 2;
    let oldJoined = false;
    oldGen.onjoined = function() { oldJoined = true; };
    oldGen.onbeforeclose = sc.onbeforeclose;
    oldGen.onclose = sc.onclose;
    oldGen.socket.close(1006, "drop");
    ok(before, "onbeforeclose rodou");
    ok(keysAtBefore.indexOf("s1") >= 0, "uplink ainda existe no snapshot: " + keysAtBefore.join(","));
    ok(after, "onclose rodou");
    ok(stream.pc.closed, "PC fechado");
    ok(!track.stopped, "track preservada");
    ok(track.readyState === "live", "track segue live");

    sc2.onjoined = function() { /* nova geração */ };
    oldGen.onjoined.call(oldGen, "join", "sala", [], {}, {}, "", "");
    ok(oldJoined, "callback antigo ainda existe no objeto morto, mas a sala nova ignora _gen");
    ok(sc2._gen === 2 && oldGen._gen !== 2, "gerações distintas");

    sc2.capabilities = ["spartan-request-by-id-v1"];
    sc2.socket = new FakeWebSocket("ws://lab/ws");
    sc2.requestStreamById("peer", "live1", ["video"]);
    const req = sc2.socket.sent.find(function(m) { return m.type === "requestStreamById"; });
    ok(req, "requestStreamById enviado");
    ok(req.dest === "peer" && req.id === "live1", "dest=publisher + id");
    ok(!req.source, "não manda source (Galene trata como spoof)");
    ok(req.request.length === 1 && req.request[0] === "video", "video high, sem video-low");

    sc2.requestStreamById("peer", "live1", []);
    const cancel = sc2.socket.sent.filter(function(m) { return m.type === "requestStreamById"; }).pop();
    ok(cancel.request.length === 0, "pedido vazio cancela só essa live");

    console.log("ok");
}

main().catch(function(e) {
    console.error(e);
    process.exit(1);
});
