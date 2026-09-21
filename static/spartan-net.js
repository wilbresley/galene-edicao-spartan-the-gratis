/* Spartan — microfone (voiceIsolation) e postMessage com origem do host.
 * Carregar depois de /settings.js, antes de /galene.js.
 */
'use strict';

function spartanMicConstraints(base) {
    /** @type {MediaTrackConstraints} */
    let a = (base && typeof base === 'object') ? Object.assign({}, base) : {};
    if(getSettings().preprocessing === false) {
        a.echoCancellation = false;
        a.noiseSuppression = false;
        a.autoGainControl = false;
        a.voiceIsolation = false;
    } else {
        a.echoCancellation = true;
        a.noiseSuppression = true;
        a.autoGainControl = true;
        a.voiceIsolation = true;
    }
    return a;
}

function spartanPostToParent(data) {
    try {
        if(window.parent !== window)
            window.parent.postMessage(data, location.origin);
    } catch(e) {}
}

function spartanNotifyPanel(ok) {
    spartanPostToParent({t: 'spartan-panel', ok: !!ok});
}

window.spartanMicConstraints = spartanMicConstraints;
window.spartanPostToParent = spartanPostToParent;
window.spartanNotifyPanel = spartanNotifyPanel;
