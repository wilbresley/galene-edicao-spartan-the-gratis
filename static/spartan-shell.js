'use strict';

/**
 * Shell SPA Spartan — home, salas e sala (iframe) na mesma aba.
 * Admin abre em overlay full-screen (estilo Discord).
 * Dentro da sala não há barra extra: controles ficam no iframe.
 */
(function() {
  var views = {
    home: document.getElementById('spartan-view-home'),
    salas: document.getElementById('spartan-view-salas'),
    room: document.getElementById('spartan-view-room'),
  };
  var roomFrame = document.getElementById('spartan-room-frame');
  var adminOverlay = document.getElementById('spartan-admin-overlay');
  var adminFrame = document.getElementById('spartan-admin-frame');
  var currentRoom = null;

  function parseRoute() {
    var h = (location.hash || '').replace(/^#/, '');
    if(!h || h === '/' || h === '/home') return { view: 'home' };
    if(h === '/salas' || h.indexOf('/salas/') === 0) return { view: 'salas' };
    var m = h.match(/^\/group\/([^/]+)\/?$/);
    if(m) return { view: 'room', group: decodeURIComponent(m[1]) };
    m = (location.pathname || '').match(/^\/group\/([^/]+)\/?$/);
    if(m && document.documentElement.classList.contains('spartan-shell')) {
      return { view: 'room', group: decodeURIComponent(m[1]) };
    }
    return { view: 'home' };
  }

  function showView(name, group) {
    Object.keys(views).forEach(function(k) {
      if(views[k]) views[k].classList.toggle('on', k === name);
    });
    var inRoom = name === 'room';
    document.documentElement.classList.toggle('spartan-in-room', inRoom);
    if(inRoom && group && roomFrame) {
      var src = '/group/' + encodeURIComponent(group) + '/?shell=1';
      if(roomFrame.getAttribute('src') !== src) {
        roomFrame.setAttribute('src', src);
      }
      currentRoom = group;
      try { localStorage.setItem('spartanLastRoom', group); } catch(e) {}
    }
    if(!inRoom && roomFrame) {
      roomFrame.setAttribute('src', 'about:blank');
      currentRoom = null;
    }
    document.title = inRoom
      ? ('Sala ' + (group || currentRoom || '') + ' — Spartan')
      : (name === 'salas' ? 'Salas — Spartan' : 'Spartan');
  }

  function navigate(route) {
    if(route.view === 'home') {
      if(location.hash !== '#/' && location.hash !== '')
        history.pushState(null, '', '#/');
      showView('home');
      return;
    }
    if(route.view === 'salas') {
      history.pushState(null, '', '#/salas');
      showView('salas');
      if(typeof window.spartanSalasInit === 'function') window.spartanSalasInit();
      return;
    }
    if(route.view === 'room' && route.group) {
      history.pushState(null, '', '#/group/' + encodeURIComponent(route.group));
      showView('room', route.group);
      return;
    }
    showView('home');
  }

  function openAdmin() {
    if(!adminOverlay || !adminFrame) return;
    adminFrame.src = '/admin/?embed=1';
    adminOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeAdmin() {
    if(!adminOverlay) return;
    adminOverlay.hidden = true;
    if(adminFrame) adminFrame.src = 'about:blank';
    document.body.style.overflow = '';
  }

  window.SpartanApp = {
    navigate: navigate,
    openAdmin: openAdmin,
    closeAdmin: closeAdmin,
    goRoom: function(gid) { navigate({ view: 'room', group: gid }); },
    goHome: function() { navigate({ view: 'home' }); },
    goSalas: function() { navigate({ view: 'salas' }); },
  };

  document.addEventListener('click', function(e) {
    var a = e.target.closest('[data-spartan-route]');
    if(!a) return;
    e.preventDefault();
    var r = a.getAttribute('data-spartan-route');
    if(r === 'home') navigate({ view: 'home' });
    else if(r === 'salas') navigate({ view: 'salas' });
    else if(r.indexOf('group:') === 0) navigate({ view: 'room', group: r.slice(6) });
  }, true);

  window.addEventListener('hashchange', function() { navigate(parseRoute()); });
  window.addEventListener('popstate', function() { navigate(parseRoute()); });

  window.addEventListener('message', function(ev) {
    var d = ev.data || {};
    if(d.t === 'spartan-admin-close') closeAdmin();
    if(d.t === 'spartan-open-admin') openAdmin();
  });

  var closeBtn = document.getElementById('spartan-admin-close');
  if(closeBtn) closeBtn.addEventListener('click', closeAdmin);

  document.addEventListener('keydown', function(e) {
    if(e.key === 'Escape' && adminOverlay && !adminOverlay.hidden) closeAdmin();
  });

  document.documentElement.classList.add('spartan-shell');

  /* /group/x/ direto → shell SPA (exceto token ou iframe) */
  (function() {
    try {
      if(new URLSearchParams(location.search).get('shell') === '1') return;
      if(window.top !== window) return;
      if(location.search && new URLSearchParams(location.search).has('token')) return;
      var m = location.pathname.match(/\/group\/([^/]+)\/?$/);
      if(!m) return;
      var gid = encodeURIComponent(decodeURIComponent(m[1]));
      location.replace('/#/group/' + gid);
    } catch(e) {}
  })();

  navigate(parseRoute());

  var enterBtn = document.getElementById('spartan-btn');
  if(enterBtn) {
    var preloaded = false;
    enterBtn.addEventListener('mouseenter', function() {
      if(preloaded) return;
      preloaded = true;
      var l = document.createElement('link');
      l.rel = 'prefetch';
      l.href = '/galene.js?v=98';
      document.head.appendChild(l);
    }, { once: true });
  }
})();
