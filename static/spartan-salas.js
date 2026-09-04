'use strict';

(function(global) {
    function fmtRemaining(info) {
        if(!info || info.remaining_s == null) return '';
        var s = Math.max(0, info.remaining_s | 0);
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        return h + 'h ' + String(m).padStart(2, '0') + 'min';
    }

    function fmtLive(s) {
        s = Math.max(0, s | 0);
        if(!s) return '';
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        if(h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'min';
        if(m > 0) return m + 'min';
        return s + 's';
    }

    function roomTag(s) {
        if(s.main) return 'Principal';
        if(s.ttl) return (s.open ? 'Pública' : 'Convite') + ' · 24h';
        return s.open ? 'Pública' : 'Convite';
    }

    function mount(opts) {
        opts = opts || {};
        var all = [];
        var q = '';
        var sort = 'az';
        var hideTemporary = opts.hideTemporary !== false;
        var mainEl = document.getElementById(opts.mainId || 'spartan-salas-main');
        var permEl = document.getElementById(opts.permId || 'spartan-salas-perm');
        var tempEl = hideTemporary ? null : document.getElementById(opts.tempId || 'spartan-salas-temp');
        var qInput = document.getElementById(opts.qId || 'spartan-salas-q');
        var currentGroup = opts.currentGroup || '';

        if(hideTemporary) {
            document.querySelectorAll('.spartan-salas-col-temp, #spartan-salas-temp, #salas-temp').forEach(function(el) {
                el.remove();
            });
            document.querySelectorAll('.spartan-salas-grid-public, .spartan-salas-page-grid, #spartan-salas-overlay .spartan-salas-grid').forEach(function(el) {
                el.classList.add('spartan-salas-grid-public');
            });
        }

        function matches(s) {
            var qq = q.trim().toLowerCase();
            var t = ((s.title || s.id || '') + ' ' + (s.id || '')).toLowerCase();
            return !qq || t.indexOf(qq) >= 0;
        }

        function sortList(list, mainFirst) {
            list.sort(function(a, b) {
                if(mainFirst) {
                    if(a.main && !b.main) return -1;
                    if(b.main && !a.main) return 1;
                }
                if(sort === 'time') {
                    if(a.ttl && b.ttl) {
                        var ra = (a.remaining_s | 0);
                        var rb = (b.remaining_s | 0);
                        if(ra !== rb) return ra - rb;
                    }
                    var d = String(b.updated || '').localeCompare(String(a.updated || ''));
                    if(d) return d;
                }
                return String(a.title || a.id).localeCompare(String(b.title || b.id), 'pt');
            });
        }

        function paintRow(s, isMain) {
            var row = document.createElement(opts.link ? 'a' : 'button');
            row.className = 'sala-item' + (isMain ? ' sala-item-main' : '');
            if(opts.link) {
                row.href = opts.hrefPrefix ? (opts.hrefPrefix + encodeURIComponent(s.id)) : ('#/group/' + encodeURIComponent(s.id));
                if(opts.routeAttr) row.setAttribute('data-spartan-route', 'group:' + s.id);
            } else {
                row.type = 'button';
            }
            var rem = s.ttl ? fmtRemaining(s) : '';
            var on = (s.online | 0) > 0 ? String(s.online) : '';
            var live = (s.live_active && s.live_s) ? fmtLive(s.live_s) : '';
            row.innerHTML =
                '<span class="sala-item-name"><b></b></span>' +
                '<span class="sala-item-right">' +
                (on ? '<span class="sala-online" title="Online agora">' + on + '</span>' : '') +
                (live ? '<span class="sala-live" title="Tempo com gente na sala">' + live + '</span>' : '') +
                '<span class="sala-tag"></span>' +
                (rem ? '<span class="sala-rem">' + rem + '</span>' : '') +
                '</span>';
            row.querySelector('b').textContent = s.title || s.id;
            row.querySelector('.sala-tag').textContent = roomTag(s);
            if(!opts.link) {
                row.onclick = function() {
                    if(s.id === currentGroup) {
                        if(typeof opts.onClose === 'function') opts.onClose();
                        return;
                    }
                    if(typeof opts.onClose === 'function') opts.onClose();
                    if(typeof opts.onPick === 'function') opts.onPick(s.id);
                };
            }
            return row;
        }

        function fill(el, items, emptyText, isMainSlot) {
            if(!el) return;
            el.innerHTML = '';
            if(!items.length) {
                var p = document.createElement('p');
                p.className = 'salas-empty';
                p.textContent = emptyText;
                el.appendChild(p);
                return;
            }
            items.forEach(function(s) {
                el.appendChild(paintRow(s, isMainSlot && s.main));
            });
        }

        function draw() {
            var main = null;
            var permanent = [];
            var temporary = [];
            all.forEach(function(s) {
                if(!matches(s)) return;
                if(s.main) main = s;
                else if(s.ttl) {
                    if(!hideTemporary) temporary.push(s);
                }
                else permanent.push(s);
            });
            sortList(permanent, false);
            sortList(temporary, false);
            if(mainEl) {
                mainEl.innerHTML = '';
                if(main) mainEl.appendChild(paintRow(main, true));
                else {
                    var p = document.createElement('p');
                    p.className = 'salas-empty';
                    p.textContent = 'Sala principal não listada.';
                    mainEl.appendChild(p);
                }
            }
            fill(permEl, permanent, 'Nenhuma sala permanente extra.');
            if(tempEl) fill(tempEl, temporary, 'Nenhuma sala temporária ativa.');
        }

        var pollTimer = 0;

        function load(silent) {
            if(!silent) {
                if(mainEl) mainEl.innerHTML = '<p class="salas-empty">Carregando…</p>';
                if(permEl) permEl.innerHTML = '';
                if(tempEl) tempEl.innerHTML = '';
            }
            fetch('/spartan-api/rooms' + (opts.all ? '?all=0' : ''), {cache: 'no-store'})
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    all = data || [];
                    draw();
                })
                .catch(function() {
                    if(mainEl) mainEl.innerHTML = '<p class="salas-empty">Não deu para listar as salas.</p>';
                });
        }

        function startPoll() {
            if(pollTimer) return;
            pollTimer = setInterval(function() { load(true); }, 10000);
        }

        function stopPoll() {
            if(!pollTimer) return;
            clearInterval(pollTimer);
            pollTimer = 0;
        }

        if(qInput) {
            qInput.addEventListener('input', function(e) {
                q = e.target.value;
                draw();
            });
        }
        document.querySelectorAll(opts.sortSelector || '#spartan-salas-overlay .sort-btn, .salas-tools [data-sort]').forEach(function(btn) {
            btn.onclick = function() {
                sort = btn.getAttribute('data-sort') || 'az';
                document.querySelectorAll(opts.sortSelector || '#spartan-salas-overlay .sort-btn, .salas-tools [data-sort]').forEach(function(x) {
                    x.classList.toggle('on', x === btn);
                });
                draw();
            };
        });

        return {load: load, draw: draw, startPoll: startPoll, stopPoll: stopPoll};
    }

    global.SpartanSalas = {mount: mount};
})(typeof window !== 'undefined' ? window : globalThis);
