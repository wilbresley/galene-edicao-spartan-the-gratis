/* Spartan — ICE da live: ignora loopback fora do lab.
 * O restart de ICE de um uplink continua no protocol.js (failed → restartIce).
 * Carregar com os outros defer da sala (o filtro roda na hora do candidato).
 */
'use strict';

function spartanIsLabHost() {
    try {
        return /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);
    } catch(e) {
        return false;
    }
}

function spartanFilterIceCandidate(cand) {
    if(!cand || spartanIsLabHost())
        return true;
    let s = String(cand.candidate || cand || '');
    if(/\s127\.0\.0\.1\s/.test(s) || /\s::1\s/.test(s) || /\s0\.0\.0\.0\s/.test(s))
        return false;
    return true;
}
