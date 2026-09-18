'use strict';

/**
 * Shell SPA — login, convidado e servidor. Sem página de salas soltas.
 */
(function() {
  var views = {
    home: document.getElementById('spartan-view-home'),
    guest: document.getElementById('spartan-view-guest'),
    room: document.getElementById('spartan-view-room'),
  };
  var roomFrame = document.getElementById('spartan-room-frame');
  var adminOverlay = document.getElementById('spartan-admin-overlay');
  var adminFrame = document.getElementById('spartan-admin-frame');
  var currentRoom = null;
  var currentServer = null;
  var currentChannel = null;

  function parseRoute() {
    var h = (location.hash || '').replace(/^#/, '');
    if(!h || h === '/' || h === '/home') return { view: 'home' };
    var inv = h.match(/^\/i\/([^/]+)\/?$/);
    if(inv) {
      var code = inv[1];
      try { code = decodeURIComponent(code); } catch(e) {}
      return { view: 'invite', code: code };
    }
    if(h === '/convidado' || h.indexOf('/convidado/') === 0) {
      var rest = h.replace(/^\/convidado\/?/, '');
      if(rest) {
        try { rest = decodeURIComponent(rest); } catch(e) {}
        return { view: 'invite', code: rest };
      }
      return { view: 'guest' };
    }
    if(h === '/salas' || h.indexOf('/salas/') === 0) return { view: 'home' };
    var s = h.match(/^\/s\/([^/]+)(?:\/([^/]*))?\/?$/);
    if(s) {
      return {
        view: 'server',
        server: decodeURIComponent(s[1]),
        channel: decodeURIComponent(s[2] || '') || '',
      };
    }
    var m = h.match(/^\/group\/([^/]+)\/?$/);
    if(m) return { view: 'room', group: decodeURIComponent(m[1]) };
    m = (location.pathname || '').match(/^\/group\/([^/]+)\/?$/);
    if(m && document.documentElement.classList.contains('spartan-shell')) {
      return { view: 'room', group: decodeURIComponent(m[1]) };
    }
    return { view: 'home' };
  }

  function showView(name, group) {
    var roomLike = name === 'room' || name === 'server';
    Object.keys(views).forEach(function(k) {
      if(views[k]) views[k].classList.toggle('on', k === name || (k === 'room' && roomLike));
    });
    document.documentElement.classList.toggle('spartan-in-room', roomLike);
    document.documentElement.classList.toggle('spartan-in-server', roomLike);
    if(!roomLike && roomFrame) {
      roomFrame.setAttribute('src', 'about:blank');
      currentRoom = null;
      currentServer = null;
      currentChannel = null;
      if(window.SpartanServers) window.SpartanServers.deactivate();
    }
    if(roomLike && group) {
      currentRoom = group;
      try { localStorage.setItem('spartanLastRoom', group); } catch(e) {}
    }
    document.title = roomLike
      ? ((currentServer ? currentServer : 'Sala') + ' — Spartan')
      : (name === 'guest' ? 'Convidado — Spartan' : 'Spartan');
  }

  function hashFor(route) {
    if(route.view === 'home') return '#/';
    if(route.view === 'invite' && route.code) return '#/i/' + encodeURIComponent(route.code);
    if(route.view === 'guest') return '#/convidado';
    if(route.view === 'server' && route.server) {
      var h = '#/s/' + encodeURIComponent(route.server);
      if(route.channel) h += '/' + encodeURIComponent(route.channel);
      return h;
    }
    if(route.view === 'room' && route.group) return '#/group/' + encodeURIComponent(route.group);
    return '#/';
  }

  function navigate(route) {
    if(route.view === 'home') {
      if(location.hash !== '#/' && location.hash !== '')
        history.pushState(null, '', '#/');
      showView('home');
      return;
    }
    if(route.view === 'invite') {
      var code = route.code || '';
      history.pushState(null, '', code ? ('#/i/' + encodeURIComponent(code)) : '#/convidado');
      if(window.SpartanServers && typeof window.SpartanServers.handleInvite === 'function' && window.SpartanServers.handleInvite(code))
        return;
      showView('guest');
      if(typeof window.spartanApplyInviteLanding === 'function') window.spartanApplyInviteLanding();
      return;
    }
    if(route.view === 'guest') {
      history.pushState(null, '', '#/convidado');
      showView('guest');
      if(typeof window.spartanApplyInviteLanding === 'function') window.spartanApplyInviteLanding();
      return;
    }
    if(route.view === 'server' && route.server) {
      currentServer = route.server;
      currentChannel = route.channel || '';
      history.pushState(null, '', hashFor(route));
      showView('server');
      if(window.SpartanServers) window.SpartanServers.activate(route);
      return;
    }
    if(route.view === 'room' && route.group) {
      history.pushState(null, '', '#/group/' + encodeURIComponent(route.group));
      showView('room', route.group);
      if(window.SpartanServers) window.SpartanServers.activate({ group: route.group });
      else if(roomFrame) {
        var src = '/group/' + encodeURIComponent(route.group) + '/?shell=1';
        if(roomFrame.getAttribute('src') !== src) roomFrame.setAttribute('src', src);
      }
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
    goRoom: function(gid) {
      if(window.SpartanServers && window.SpartanServers.goGroup(gid)) return;
      navigate({ view: 'room', group: gid });
    },
    goServer: function(sid, cid) {
      navigate({ view: 'server', server: sid, channel: cid || '' });
    },
    goHome: function() { navigate({ view: 'home' }); },
    goSalas: function() { navigate({ view: 'home' }); },
  };

  document.addEventListener('click', function(e) {
    var a = e.target.closest('[data-spartan-route]');
    if(!a) return;
    e.preventDefault();
    var r = a.getAttribute('data-spartan-route');
    if(r === 'home') navigate({ view: 'home' });
    else if(r === 'convidado') navigate({ view: 'guest' });
    else if(r === 'salas') navigate({ view: 'home' });
    else if(r.indexOf('server:') === 0) {
      var parts = r.slice(7).split('/');
      navigate({ view: 'server', server: parts[0], channel: parts[1] || 'voz-1' });
    }
    else if(r.indexOf('group:') === 0) navigate({ view: 'room', group: r.slice(6) });
  }, true);

  window.addEventListener('hashchange', function() { navigate(parseRoute()); });
  window.addEventListener('popstate', function() { navigate(parseRoute()); });

  window.addEventListener('message', function(ev) {
    if(ev.origin !== location.origin) return;
    var d = ev.data || {};
    if(d.t === 'spartan-admin-close') closeAdmin();
    if(d.t === 'spartan-open-admin') openAdmin();
    if(d.t === 'spartan-go-home') navigate({ view: 'home' });
  });

  var closeBtn = document.getElementById('spartan-admin-close');
  if(closeBtn) closeBtn.addEventListener('click', closeAdmin);

  document.addEventListener('keydown', function(e) {
    if(e.key === 'Escape' && adminOverlay && !adminOverlay.hidden) closeAdmin();
  });

  document.documentElement.classList.add('spartan-shell');

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
})();
