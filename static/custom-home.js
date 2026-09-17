'use strict';

var API = '/spartan-api';

function spartanSaveCred(user, pass, scope) {
  try {
    sessionStorage.setItem('spartanGlobalCred', JSON.stringify({ user: user, pass: pass, account: true }));
    if(scope) sessionStorage.setItem('spartanAdmin', JSON.stringify({ user: user, pass: pass }));
    else sessionStorage.removeItem('spartanAdmin');
  } catch(e) {}
}

function spartanApiPost(path, body) {
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

var firstSetupUser = '';
var firstSetupPass = '';
var firstSetupIsAdmin = false;

function spartanShowFirstSetup(user, pass, isAdmin) {
  var modal = document.getElementById('spartan-first-modal');
  if(!modal) return;
  firstSetupUser = user;
  firstSetupPass = pass;
  firstSetupIsAdmin = !!isAdmin;
  var lead = document.getElementById('spartan-first-lead');
  var adminFields = document.getElementById('spartan-first-admin-fields');
  var userFields = document.getElementById('spartan-first-user-fields');
  if(lead) lead.textContent = firstSetupIsAdmin
    ? 'Troque a senha do admin e a senha dos convidados da sala. Não use a senha de fábrica.'
    : 'Troque a senha de fábrica. Não use Mudar@123 de novo.';
  if(adminFields) adminFields.hidden = !firstSetupIsAdmin;
  if(userFields) userFields.hidden = firstSetupIsAdmin;
  modal.hidden = false;
  var ok = document.getElementById('spartan-first-ok');
  if(!ok || ok.dataset.bound) return;
  ok.dataset.bound = '1';
  ok.addEventListener('click', function() {
    var err = document.getElementById('spartan-first-err');
    if(err) err.textContent = '';
    if(firstSetupIsAdmin) {
      var a = (document.getElementById('spartan-first-admin') && document.getElementById('spartan-first-admin').value) || '';
      var f = (document.getElementById('spartan-first-friends') && document.getElementById('spartan-first-friends').value) || '';
      if(!a || a.length < 8 || !f || f.length < 8) {
        if(err) err.textContent = 'Mínimo 8 caracteres em cada senha.';
        return;
      }
      if(a === 'Mudar@123' || f === 'Mudar@123') {
        if(err) err.textContent = 'Não use a senha de fábrica.';
        return;
      }
      spartanApiPost('/first-setup', { user: firstSetupUser, old: firstSetupPass, admin_password: a, friends_password: f }).then(function() {
        spartanSaveCred(firstSetupUser, a, 'admin');
        modal.hidden = true;
      }).catch(function(e) {
        if(err) err.textContent = e.message || 'Não atualizou as senhas.';
      });
      return;
    }
    var n1 = (document.getElementById('spartan-first-new') && document.getElementById('spartan-first-new').value) || '';
    var n2 = (document.getElementById('spartan-first-new2') && document.getElementById('spartan-first-new2').value) || '';
    if(!n1 || n1.length < 8) {
      if(err) err.textContent = 'Nova senha: mínimo 8 caracteres.';
      return;
    }
    if(n1 !== n2) {
      if(err) err.textContent = 'As senhas não conferem.';
      return;
    }
    if(n1 === 'Mudar@123') {
      if(err) err.textContent = 'Não use a senha de fábrica.';
      return;
    }
    spartanApiPost('/first-password', { user: firstSetupUser, old: firstSetupPass, new: n1 }).then(function() {
      spartanSaveCred(firstSetupUser, n1, null);
      modal.hidden = true;
    }).catch(function(e) {
      if(err) err.textContent = e.message || 'Não atualizou a senha.';
    });
  });
}

function spartanMaybeFirstSetup(user, pass) {
  if(!user || !pass) return;
  spartanApiPost('/must-change', { user: user, password: pass }).then(function(j) {
    if(j && j.must_change) spartanShowFirstSetup(user, pass, j.admin);
  }).catch(function() {});
}

function inviteCodeFrom(raw) {
  raw = (raw || '').trim();
  if(!raw) return '';
  var m = raw.match(/#\/i\/([^/?#]+)/) || raw.match(/#\/convidado\/([^/?#]+)/);
  if(m) {
    try { return decodeURIComponent(m[1]); } catch(e) { return m[1]; }
  }
  return raw;
}

function pendingInviteGet() {
  try { return sessionStorage.getItem('spartanPendingInvite') || ''; } catch(e) { return ''; }
}

function pendingInviteSet(code) {
  code = inviteCodeFrom(code);
  try {
    if(code) sessionStorage.setItem('spartanPendingInvite', code);
    else sessionStorage.removeItem('spartanPendingInvite');
  } catch(e) {}
}

function inviteFromHash() {
  var h = (location.hash || '').replace(/^#/, '');
  var m = h.match(/^\/i\/([^/]+)/) || h.match(/^\/convidado\/(.+)/);
  if(!m) return '';
  try { return decodeURIComponent(m[1]); } catch(e) { return m[1]; }
}

function spartanApplyInviteLanding() {
  var code = inviteFromHash() || pendingInviteGet();
  var input = document.getElementById('spartan-guest-invite');
  var wrap = document.getElementById('spartan-guest-invite-wrap');
  var tag = document.getElementById('spartan-guest-tag');
  if(input && code) input.value = code;
  if(wrap) wrap.hidden = !!code;
  if(code) {
    pendingInviteSet(code);
    fetch(API + '/server-invite?code=' + encodeURIComponent(code), { cache: 'no-store' }).then(function(r) {
      return r.json().then(function(j) { return { ok: r.ok, j: j }; });
    }).then(function(x) {
      if(tag) {
        if(x.ok && x.j && x.j.title) tag.textContent = 'Convite para ' + x.j.title;
        else tag.textContent = 'Convite inválido ou expirado';
      }
    }).catch(function() {
      if(tag) tag.textContent = 'Convite inválido ou expirado';
    });
  } else if(tag) tag.textContent = 'Entrar com convite';
}
window.spartanApplyInviteLanding = spartanApplyInviteLanding;

function afterLoginGo(user, pass, j, msgEl) {
  var pending = pendingInviteGet();
  var dest = j.home;
  function go(id) {
    if(j.must_change) spartanShowFirstSetup(user, pass, j.first_setup_admin);
    if(id) {
      pendingInviteSet('');
      if(window.SpartanApp) window.SpartanApp.goServer(id, 'geral');
      else location.hash = '#/s/' + encodeURIComponent(id) + '/geral';
      return;
    }
    if(msgEl) msgEl.textContent = 'Você ainda não foi convidado para nenhum servidor.';
  }
  if(!pending) {
    go(dest);
    return;
  }
  spartanApiPost('/server-join', { user: user, password: pass, invite: pending }).then(function(r) {
    go(r.id || dest);
  }).catch(function(err) {
    if(msgEl) msgEl.textContent = err.message || 'Convite inválido.';
    if(dest) go(dest);
  });
}

function bindLogin() {
  var form = document.getElementById('spartan-login-form');
  if(!form || form.dataset.bound) return;
  form.dataset.bound = '1';
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var user = (document.getElementById('spartan-login-user') && document.getElementById('spartan-login-user').value || '').trim().toLowerCase();
    var pass = (document.getElementById('spartan-login-pass') && document.getElementById('spartan-login-pass').value) || '';
    var msg = document.getElementById('spartan-login-msg');
    if(!user || !pass) {
      if(msg) msg.textContent = 'Preencha usuário e senha.';
      return;
    }
    spartanApiPost('/account-login', { user: user, password: pass }).then(function(j) {
      spartanSaveCred(user, pass, j.panel_scope);
      afterLoginGo(user, pass, j, msg);
    }).catch(function(err) {
      if(msg) msg.textContent = err.message || 'Usuário ou senha inválidos.';
    });
  });
}

function bindGuest() {
  var form = document.getElementById('spartan-guest-form');
  if(!form || form.dataset.bound) return;
  form.dataset.bound = '1';
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var user = (document.getElementById('spartan-guest-user') && document.getElementById('spartan-guest-user').value || '').trim().toLowerCase();
    var pass = (document.getElementById('spartan-guest-pass') && document.getElementById('spartan-guest-pass').value) || '';
    var pass2 = (document.getElementById('spartan-guest-pass2') && document.getElementById('spartan-guest-pass2').value) || '';
    var invite = inviteCodeFrom((document.getElementById('spartan-guest-invite') && document.getElementById('spartan-guest-invite').value || '').trim()) || inviteFromHash() || pendingInviteGet();
    var msg = document.getElementById('spartan-guest-msg');
    if(!user || !pass || !invite) {
      if(msg) msg.textContent = 'Preencha nick, senha e o link de convite.';
      return;
    }
    if(pass !== pass2) {
      if(msg) msg.textContent = 'As senhas não conferem.';
      return;
    }
    if(pass.length < 8) {
      if(msg) msg.textContent = 'Senha mínimo 8 caracteres.';
      return;
    }
    pendingInviteSet(invite);
    spartanApiPost('/server-guest', { user: user, password: pass, password2: pass2, invite: invite }).then(function(j) {
      pendingInviteSet('');
      spartanSaveCred(user, pass, null);
      var dest = j.id;
      if(window.SpartanApp) window.SpartanApp.goServer(dest, 'geral');
      else location.hash = '#/s/' + encodeURIComponent(dest) + '/geral';
    }).catch(function(err) {
      var t = (err && err.message) || '';
      if(t.indexOf('ja tem conta') >= 0) {
        if(msg) msg.textContent = 'Esse nick já tem conta. Use Já tenho conta e entre com a senha.';
        return;
      }
      if(msg) msg.textContent = t || 'Não entrou.';
    });
  });
  var have = document.querySelector('#spartan-view-guest [data-spartan-route="home"]');
  if(have && !have.dataset.inviteBound) {
    have.dataset.inviteBound = '1';
    have.addEventListener('click', function() {
      var code = inviteCodeFrom((document.getElementById('spartan-guest-invite') && document.getElementById('spartan-guest-invite').value) || '') || inviteFromHash();
      pendingInviteSet(code);
    });
  }
}

bindLogin();
bindGuest();
try {
  var saved = JSON.parse(sessionStorage.getItem('spartanGlobalCred') || 'null');
  if(saved && saved.user && saved.pass) spartanMaybeFirstSetup(saved.user, saved.pass);
} catch(e) {}
