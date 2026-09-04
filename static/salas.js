'use strict';

(function() {
    function init() {
        if(typeof SpartanSalas === 'undefined') return;
        var api = SpartanSalas.mount({
            mainId: 'salas-main',
            permId: 'salas-perm',
            qId: 'sala-q',
            hideTemporary: true,
            sortSelector: '.salas-tools [data-sort]',
            link: true,
            routeAttr: true,
        });
        window.spartanSalasInit = function() { api.load(); api.startPoll(); };
        api.load();
        api.startPoll();
    }
    if(document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();
})();
