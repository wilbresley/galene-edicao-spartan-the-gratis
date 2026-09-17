'use strict';
function uiMsg(m){var t=document.getElementById('ui-toast'); if(!t) return; t.textContent=m; t.hidden=false; clearTimeout(window._uiT); window._uiT=setTimeout(function(){t.hidden=true;},3200);}
function uiDlg(msg,kind){return new Promise(function(resolve){var d=document.getElementById('ui-dlg'),i=document.getElementById('ui-dlg-input'),c=document.getElementById('ui-dlg-cancel'); if(!d){resolve(kind==='prompt'?null:true);return;} document.getElementById('ui-dlg-msg').textContent=msg; i.value=''; i.classList.toggle('is-off', kind!=='prompt'); c.classList.toggle('is-off', kind==='ok'); d.hidden=false; document.getElementById('ui-dlg-ok').onclick=function(){d.hidden=true; resolve(kind==='prompt'?i.value:true);}; c.onclick=function(){d.hidden=true; resolve(kind==='prompt'?null:false);};});}
function uiConfirm(m){return uiDlg(m,'confirm');}
function uiPrompt(m){return uiDlg(m,'prompt');}

const API_BASES=['/spartan-api/gapi','/galene-api/v0'];
let API=API_BASES[0];
const REG='/spartan-api';
let GROUP='spartan', user='', pass='', PANEL_SCOPE='', registry={}, SITE={main:'spartan',home:'spartan'};
async function loadSite(){ try{ SITE=await (await fetch(REG+'/site',{cache:'no-store'})).json(); }catch(e){ SITE={main:'spartan',home:'spartan'}; } GROUP=SITE.main||'spartan'; bindBackToRoom(); }
function roomGid(){
 var gid=SITE.home||SITE.main||'spartan';
 try{ var last=localStorage.getItem('spartanLastRoom'); if(last) gid=last; }catch(e){}
 return gid;
}
function adminIsEmbed(){ try{ return new URLSearchParams(location.search).get('embed')==='1'; }catch(e){ return false; } }
function adminInShell(){ return adminIsEmbed() && window.parent !== window; }
function adminCloseShell(){ try{ if(window.parent!==window) window.parent.postMessage({t:'spartan-admin-close'}, location.origin); }catch(e){} }
function bindBackToRoom(){
 var a=document.querySelector('.btn-back');
 if(!a) return;
 var gid=roomGid();
 if(adminIsEmbed()){
  a.textContent='Voltar à sala';
  a.href='#';
  if(a.dataset.bound) return;
  a.dataset.bound='1';
  a.addEventListener('click', function(e){ e.preventDefault(); adminCloseShell(); });
  return;
 }
 a.href='/#/group/'+encodeURIComponent(gid);
 if(a.dataset.bound) return;
 a.dataset.bound='1';
 a.addEventListener('click', async function(e){
  e.preventDefault();
  var dest=roomGid();
  if(window.SpartanApp){ window.SpartanApp.goRoom(dest); return; }
  location.href='/#/group/'+encodeURIComponent(dest);
 });
}
function authHeader(){return 'Basic '+btoa(unescape(encodeURIComponent(user+':'+pass)));}
async function api(path,opt){
 opt=opt||{};
 const hdr=Object.assign({'Authorization':authHeader(),'X-Spartan-Auth':authHeader()},opt.headers||{});
 const order=API===API_BASES[1] ? [API_BASES[1], API_BASES[0]] : API_BASES.slice();
 let lastErr=null;
 for(let i=0;i<order.length;i++){
  const r=await fetch(order[i]+path,{method:opt.method||'GET',headers:hdr,body:opt.body,credentials:'omit'});
  const text=await r.text();
  if(r.ok){
   API=order[i];
   if(!text) return null;
   try{return JSON.parse(text);}catch(e){return text;}
  }
  lastErr=new Error((text||r.statusText||String(r.status)).slice(0,220));
  if(i<order.length-1 && (r.status===404 || r.status===401)) continue;
  if(r.status===401) throw new Error('Usuário ou senha inválidos');
  throw lastErr;
 }
 if(lastErr && /401/.test(String(lastErr.message))) throw new Error('Usuário ou senha inválidos');
 throw lastErr;
}
async function reg(path,body){
 const r=await fetch(REG+path,{method:body?'POST':'GET',headers:{'Authorization':authHeader(),'X-Spartan-Auth':authHeader(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,credentials:'omit'});
 const text=await r.text();
 let data=null; try{data=JSON.parse(text);}catch(e){data=text;}
 if(!r.ok) throw new Error((data&&data.error)||text||r.statusText);
 return data;
}
function $(id){return document.getElementById(id);}
function permLabel(p){return ({op:'Admin',admin:'Admin',present:'Usuário',ouvinte:'Usuário',mod:'Moderador',message:'Usuário',observe:'Usuário'})[p]||p;}
function roleFromPerm(p){
 if(p==='op'||p==='admin') return 'op';
 if(Array.isArray(p)){
  if(p.indexOf('op')>=0||p.indexOf('admin')>=0) return 'op';
  if(p.indexOf('present')>=0 && p.indexOf('message')<0) return 'ouvinte';
  if(p.indexOf('present')>=0) return 'present';
  return 'ouvinte';
 }
 if(p==='observe'||p==='message'||p==='ouvinte') return 'ouvinte';
 return 'present';
}
function permToApi(role){ return role==='ouvinte' ? ['present'] : role; }
function bucket(){const d=registry[GROUP]||{};return {guests:d.guests||{},pending:d.pending||{},denied:d.denied||{},blocked:d.blocked||{},temps:d.temps||{},ipban:d.ipban||{},created:d.created||{},seen:d.seen||{}};}
var SORT={users:"az",guests:"az",blocked:"az",temps:"az"};
function recLast(b,n){var r=(b.seen&&b.seen[n])||(b.guests||{})[n]||(b.temps||{})[n]||(b.blocked||{})[n]||(b.pending||{})[n]||{}; return r.last||r.first||r.at||"";}
function fmtQuando(iso){
 if(!iso) return "";
 try{
  var d=new Date(iso);
  if(isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
 }catch(e){return String(iso);}
}
function fmtSeen(name,gid,rec){rec=rec||{}; var bits=[]; if(gid) bits.push("sala "+gid); if(rec.ip) bits.push("IP "+rec.ip); var v=rec.last||rec.first||rec.at; if(v) bits.push("visto "+fmtQuando(v)); return bits.join(" · ");}
function tipoLabel(t){return ({cadastrado:"Cadastrado",convidado:"Convidado",temporario:"Temporário",pedido_cadastro:"Pedido de cadastro",conta_aprovada:"Conta aprovada",conta_criada:"Conta criada",painel_admin:"Admin (painel)"})[t]||t||"—";}
var PERM_OPTS=[{v:"op",l:"Admin"},{v:"present",l:"Usuário"}];
function permLabelBtn(p){for(var i=0;i<PERM_OPTS.length;i++){if(PERM_OPTS[i].v===p)return PERM_OPTS[i].l;}return "Usuário";}
function closeAllRoleMenus(){document.querySelectorAll(".role-menu.open").forEach(function(m){m.classList.remove("open");});document.querySelectorAll(".role-btn.open").forEach(function(b){b.classList.remove("open");});}
document.addEventListener("click",function(e){if(!e.target.closest||!e.target.closest(".role-wrap"))closeAllRoleMenus();});
var LOG_CACHE=[];
function logMatchesFilter(e){
 var tipo=(($("log-tipo")&&$("log-tipo").value)||"");
 var nick=((($("log-nick")&&$("log-nick").value)||"").trim().toLowerCase());
 var ip=((($("log-ip")&&$("log-ip").value)||"").trim().toLowerCase());
 var t=e.tipo||"";
 if(tipo==="cadastrado"){ if(!(t==="cadastrado"||t==="conta_aprovada"||t==="conta_criada"||t==="pedido_cadastro")) return false; }
 else if(tipo==="admin"){ if(t!=="painel_admin") return false; }
 else if(tipo==="convidado"){ if(t!=="convidado") return false; }
 else if(tipo==="temporario"){ if(t!=="temporario") return false; }
 if(nick && String(e.nick||"").toLowerCase().indexOf(nick)<0) return false;
 if(ip && String(e.ip||"").toLowerCase().indexOf(ip)<0) return false;
 return true;
}
function paintLogs(){
 const box=$("logs"); if(!box) return;
 const entries=LOG_CACHE.filter(logMatchesFilter);
 box.innerHTML="";
 if(!LOG_CACHE.length){box.textContent="Nenhum log ainda. Assim que alguém entrar na sala, aparece aqui.";return;}
 if(!entries.length){box.textContent="Nenhum resultado com estes filtros.";return;}
 entries.forEach(function(e){
  const el=document.createElement("div"); el.className="guest-row";
  const lab=document.createElement("b"); lab.textContent=e.nick||"(sem nick)";
  const tag=document.createElement("span"); tag.className="tag tag-guest"; tag.textContent=tipoLabel(e.tipo);
  const meta=document.createElement("span"); meta.className="hint";
  meta.textContent=fmtQuando(e.quando)+(e.sala?(" · sala "+e.sala):"")+(e.ip?(" · IP "+e.ip):"");
  el.appendChild(lab); el.appendChild(tag); el.appendChild(meta); box.appendChild(el);
 });
}
function sortItems(list,tab){var mode=SORT[tab]||"az"; list.sort(function(a,c){if(mode==="time"){var ta=(a.rec&&(a.rec.last||a.rec.first||a.rec.at))||""; var tc=(c.rec&&(c.rec.last||c.rec.first||c.rec.at))||""; if(tc!==ta) return tc>ta?-1:1;} return String(a.name).localeCompare(String(c.name),"pt",{sensitivity:"base"});}); return list;}
function sortNickList(names,b,tab){var mode=SORT[tab]||"az"; names.sort(function(a,c){if(mode==="time"){var d=recLast(b,c).localeCompare(recLast(b,a)); if(d) return d;} return a.localeCompare(c,"pt",{sensitivity:"base"});});}

async function refreshReg(){try{registry=await reg('/registry')||{};}catch(e){registry={}; throw e;}}

async function loadUsers(){
 const boxOps=$('users-ops'), box=$('users');
 try{await refreshReg();}catch(e){}
 let accounts={by_nick:{}};
 try{accounts=await reg('/accounts')||accounts;}catch(e){}
 const b=bucket(), skip=new Set(Object.keys(b.denied).concat(Object.keys(b.blocked),Object.keys(b.pending)));
 let names=(await api('/.groups/'+GROUP+'/.users/')||[]).filter(n=>!skip.has(n));
 names.sort((a,c)=>a.localeCompare(c,'pt',{sensitivity:'base'}));
 const rows=[];
 for(const name of names){
  let info={}; try{info=await api('/.groups/'+GROUP+'/.users/'+encodeURIComponent(name));}catch(e){}
  const uid=(accounts.by_nick&&accounts.by_nick[String(name).toLowerCase()]);
  rows.push({name, perm:roleFromPerm((info&&info.permissions)||'present'), rec:(b.seen||{})[name]||{}, id:uid});
 }
 sortItems(rows,'users');
 const uk='u:'+SORT.users+':'+rows.map(r=>r.id+':'+r.name+':'+r.perm+':'+(r.rec.ip||'')).join('|');
 if(uk===loadUsers._k) return; loadUsers._k=uk;
 if(boxOps) boxOps.innerHTML='';
 box.innerHTML='';
 const ops=rows.filter(r=>r.perm==='op');
 const rest=rows.filter(r=>r.perm!=='op');
 function render(target, list, empty){
  if(!target) return;
  if(!list.length){target.textContent=empty;return;}
  list.forEach(function(item){
   const name=item.name, perm=item.perm, uid=item.id;
   const card=document.createElement('div'); card.className='user-card';
   const row=document.createElement('div'); row.className='user-row';
   row.innerHTML='<div class="who"><b></b></div><div class="user-tools"><button type="button" class="det">Detalhes</button><button type="button" class="srvs">Servidores</button><div class="role-wrap"><button type="button" class="role-btn"></button><div class="role-menu"></div></div><div class="user-acts"><button type="button" class="ren">Renomear</button><button type="button" class="rst">Redefinir senha</button></div><div class="user-acts"><button type="button" class="del">Excluir</button><button type="button" class="blk">Bloquear</button></div></div>';
   const title=(uid!=null?('ID '+uid+' · '):'')+name;
   row.querySelector('b').textContent=title;
   const curPerm=['op','present','ouvinte'].indexOf(perm)>=0?perm:'present';
   const roleBtn=row.querySelector('.role-btn');
   const roleMenu=row.querySelector('.role-menu');
   roleBtn.textContent=permLabelBtn(curPerm)+' ▾';
   PERM_OPTS.forEach(function(o){
    const b=document.createElement('button'); b.type='button'; b.textContent=o.l; b.dataset.v=o.v;
    if(o.v===curPerm) b.classList.add('on');
    b.onclick=async function(ev){
     ev.preventDefault(); ev.stopPropagation();
     closeAllRoleMenus();
     if(o.v===curPerm) return;
     try{
      await api('/.groups/'+GROUP+'/.users/'+encodeURIComponent(name),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({permissions:permToApi(o.v)})});
      loadUsers._k=null; uiMsg('Cargo de '+name+' atualizado.');
      await loadUsers();
     }catch(e){uiMsg(e.message);}
    };
    roleMenu.appendChild(b);
   });
   roleBtn.onclick=function(ev){
    ev.preventDefault(); ev.stopPropagation();
    const open=roleMenu.classList.contains('open');
    closeAllRoleMenus();
    if(!open){ roleMenu.classList.add('open'); roleBtn.classList.add('open'); }
   };
   row.querySelector('.ren').onclick=async()=>{
    const inp=$('ui-dlg-input'); if(inp) inp.type='text';
    const nn=await uiPrompt('Novo nome para '+(uid!=null?('ID '+uid+' / '):'')+name+' (sempre minúsculo):');
    if(inp) inp.type='password';
    if(nn==null) return;
    const nick=String(nn).trim().toLowerCase();
    if(!nick){uiMsg('Nome vazio');return;}
    try{
     const body=uid!=null?{id:uid,nick:nick}:{user:name,nick:nick};
     await reg('/rename-user',body);
     loadUsers._k=null; uiMsg('Renomeado para '+nick+(uid!=null?' (ID '+uid+' intacto)':''));
     await loadUsers(); await loadGuests();
    }catch(e){uiMsg(e.message);}
   };
   row.querySelector('.rst').onclick=async()=>{
    if(!await uiConfirm('Resetar senha de '+name+' para Mudar@123? No próximo login ela troca.')) return;
    try{await reg('/reset-factory-password',{nick:name}); uiMsg('Senha de '+name+' voltou para Mudar@123');}
    catch(e){uiMsg(e.message);}
   };
   row.querySelector('.del').onclick=async()=>{
    if(!await uiConfirm('Excluir '+name+' por completo? A conta some e o nick fica livre, mas o ID'+(uid!=null?(' '+uid):'')+' permanece reservado.')) return;
    try{await api('/.groups/'+GROUP+'/.users/'+encodeURIComponent(name),{method:'DELETE'}); try{await reg('/forget',{group:GROUP,user:name});}catch(e){} loadUsers._k=null; await loadUsers(); await loadGuests(); await loadBlocked();}
    catch(e){uiMsg(e.message);}
   };
   row.querySelector('.blk').onclick=async()=>{
    if(!await uiConfirm('Bloquear '+name+'? Ele cai da sala e não entra mais até você desbloquear. A conta não é apagada.')) return;
    try{await reg('/block',{group:GROUP,user:name}); loadUsers._k=null; loadBlocked._k=null; await loadUsers(); await loadGuests(); await loadBlocked();}
    catch(e){uiMsg(e.message);}
   };
   row.querySelector('.det').onclick=function(){ card.classList.toggle('open'); };
   row.querySelector('.srvs').onclick=function(){ openUserServers(name); };
   const det=document.createElement('div'); det.className='user-details';
   const rec=item.rec||{};
   const ip=document.createElement('div'); ip.className='ip'; ip.textContent=rec.ip?('IP '+rec.ip):'IP —';
   const meta=document.createElement('div');
   meta.textContent=(GROUP?('Sala '+GROUP):'Sala —')+' · visto '+(fmtQuando(rec.last||rec.first||rec.at)||'—');
   det.appendChild(meta); det.appendChild(ip);
   card.appendChild(row); card.appendChild(det);
   target.appendChild(card);
  });
 }
 render(boxOps, ops, 'Nenhum admin além das contas do servidor.');
 render(box, rest, 'Nenhum usuário próprio.');
}

async function loadRooms(){
 const boxMain=$('rooms-main'), boxPerm=$('rooms-perm'), boxTemp=$('rooms-temp');
 if(!boxMain) return;
 const names=await api('/.groups/')||[];
 await loadSite();
 let meta={};
 try{ (await reg('/rooms?all=1')).forEach(r=>meta[r.id]=r); }catch(e){}
 const main=SITE.main||'spartan', home=SITE.home||main;
 const rest=names.filter(n=>n!==main && !(meta[n]&&meta[n].server_voice));
 const permanent=rest.filter(n=>!(meta[n]&&meta[n].ttl)).sort((x,y)=>x.localeCompare(y,'pt',{sensitivity:'base'}));
 const temporary=rest.filter(n=>meta[n]&&meta[n].ttl).sort((a,b)=>{
  const ra=(meta[a]&&meta[a].remaining_s)|0, rb=(meta[b]&&meta[b].remaining_s)|0;
  if(ra!==rb) return ra-rb;
  return a.localeCompare(b,'pt',{sensitivity:'base'});
 });
 var slim={};
 Object.keys(meta||{}).forEach(function(id){
  var m=meta[id]||{};
  slim[id]={t:m.title||'',ttl:!!m.ttl,open:!!m.open,host:m.host||'',sv:!!m.server_voice};
 });
 const key='r2:'+main+':'+home+':'+names.join('|')+JSON.stringify(slim);
 if(key===loadRooms._k){
  document.querySelectorAll('[data-room-remain]').forEach(function(el){
   var info=meta[el.getAttribute('data-room-remain')]||{};
   var rem=fmtRoomRemaining(info);
   el.textContent=rem?('⏱ '+rem):'';
  });
  return;
 }
 loadRooms._k=key;
 boxMain.innerHTML=''; boxPerm.innerHTML=''; boxTemp.innerHTML='';
 const cntP=$('rooms-perm-count'), cntT=$('rooms-temp-count');
 if(cntP) cntP.textContent='('+permanent.length+')';
 if(cntT) cntT.textContent='('+temporary.length+')';
 if(names.indexOf(main)>=0) paintRoomMain(main, meta[main]||{}, home);
 if(!permanent.length) boxPerm.innerHTML='<p class="rooms-empty">Nenhuma sala permanente extra.</p>';
 else permanent.forEach(n=>paintRoomPermanent(n, meta[n]||{}, home));
 if(!temporary.length) boxTemp.innerHTML='<p class="rooms-empty">Nenhuma sala temporária ativa.</p>';
 else temporary.forEach(n=>paintRoomTemporary(n, meta[n]||{}));
}

function fmtRoomRemaining(info){
 if(!info||info.remaining_s==null) return '';
 const s=Math.max(0, info.remaining_s|0), h=Math.floor(s/3600), m=Math.floor((s%3600)/60);
 return h+'h '+String(m).padStart(2,'0')+'min';
}
function roomTagText(info, isMain){
 let tag=isMain?'principal · ':'';
 tag+=info.open?'Pública':'Convite';
 if(info.ttl) tag+=' · 24h';
 const rem=fmtRoomRemaining(info);
 if(rem) tag+=' · '+rem;
 return tag;
}
function shellRoomLink(id){ return location.origin+'/#/group/'+encodeURIComponent(id); }
function openRoomHref(id, isMain){
 if(isMain) return location.origin+'/#/s/'+encodeURIComponent(id)+'/voz-1';
 return location.origin+'/#/group/'+encodeURIComponent(id);
}
function copyTextToClipboard(text){
 if(navigator.clipboard&&navigator.clipboard.writeText){
  return navigator.clipboard.writeText(text).then(function(){ uiMsg('Link copiado'); }).catch(function(){ fallbackCopy(text); });
 }
 fallbackCopy(text);
}
function fallbackCopy(text){
 const ta=document.createElement('textarea');
 ta.value=text; ta.style.position='fixed'; ta.style.left='-9999px';
 document.body.appendChild(ta); ta.select();
 try{ document.execCommand('copy'); uiMsg('Link copiado'); }catch(e){ uiMsg('Copie manualmente: '+text); }
 document.body.removeChild(ta);
}
async function resetRoomFriendsPassword(groupId, inputEl){
 const v=inputEl.value;
 if(!v){ uiMsg('Digite a nova senha de amigos'); return; }
 try{
  try{ await api('/.groups/'+encodeURIComponent(groupId)+'/.wildcard-user',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({permissions:'present'})}); }catch(e){}
  await api('/.groups/'+encodeURIComponent(groupId)+'/.wildcard-user/.password',{method:'POST',headers:{'Content-Type':'text/plain'},body:v});
  inputEl.value=''; uiMsg('Senha de amigos atualizada');
 }catch(e){ uiMsg(e.message); }
}
async function setRoomEntrance(groupId){
 try{
  SITE=await reg('/site-home',{group:groupId});
  loadRooms._k=null; uiMsg('Entrada do site agora é a sala '+groupId);
  await loadRooms();
 }catch(e){ uiMsg(e.message); }
}
async function deleteRoom(groupId){
 if(!await uiConfirm('Apagar a sala '+groupId+' por completo?')) return;
 try{
  await api('/.groups/'+encodeURIComponent(groupId),{method:'DELETE'});
  loadRooms._k=null; uiMsg('Sala '+groupId+' apagada');
  await loadRooms();
 }catch(e){ uiMsg(e.message); }
}

function paintRoomMain(n, info, home){
 const box=$('rooms-main'); if(!box) return;
 const wrap=document.createElement('div'); wrap.className='room-card room-card-main';
 const head=document.createElement('div'); head.className='room-card-head';
 head.innerHTML='<div class="room-card-title"><b></b><span class="room-card-sub"></span></div><span class="sala-tag"></span>';
 head.querySelector('b').textContent=info.title||n;
 head.querySelector('.room-card-sub').textContent=n+' · '+roomTagText(info, true);
 head.querySelector('.sala-tag').textContent=info.open?'Pública':'Convite';
 const acts=document.createElement('div'); acts.className='room-card-actions';
 const open=document.createElement('a'); open.className='btn-open'; open.textContent='Abrir sala'; open.href=openRoomHref(n, true); open.target='_blank'; open.rel='noopener';
 acts.appendChild(open);
 head.appendChild(acts);
 wrap.appendChild(head);
 const ed=document.createElement('div'); ed.className='room-edit';
 ed.innerHTML='<label>Título na interface</label><input class="mtitle" type="text"/><label>Endereço (URL)</label><input class="mslug" type="text"/><button type="button" class="okbtn msave">Salvar nome e endereço</button>';
 ed.querySelector('.mtitle').value=info.title||n;
 ed.querySelector('.mslug').value=n;
 ed.querySelector('.msave').onclick=async()=>{
  const title=ed.querySelector('.mtitle').value.trim();
  const id=ed.querySelector('.mslug').value.trim().toLowerCase().replace(/[^a-z0-9-]/g,'');
  if(!id){ uiMsg('URL inválida'); return; }
  try{
   SITE=await reg('/rename-main',{id:id,title:title||id});
   loadRooms._k=null; uiMsg('Sala principal atualizada: /#/s/'+id+'/voz-1');
   await loadSite(); await loadRooms();
  }catch(e){ uiMsg(e.message); }
 };
 wrap.appendChild(ed);
 if(!info.open){
  const pw=document.createElement('div'); pw.className='room-card-pw';
  pw.innerHTML='<input type="password" placeholder="Nova senha de amigos" autocomplete="new-password"/><button type="button" class="rst">Redefinir</button>';
  pw.querySelector('.rst').onclick=function(){ resetRoomFriendsPassword(n, pw.querySelector('input')); };
  wrap.appendChild(pw);
 }
 const foot=document.createElement('div'); foot.className='room-card-foot';
 if(n===home){
  foot.innerHTML='<span class="entrance-on">Entrada do site</span>';
 }else{
  const btn=document.createElement('button'); btn.type='button'; btn.className='okbtn sethome'; btn.textContent='Definir como entrada';
  btn.onclick=function(){ setRoomEntrance(n); };
  foot.appendChild(btn);
 }
 wrap.appendChild(foot);
 box.appendChild(wrap);
}

function paintRoomPermanent(n, info, home){
 const box=$('rooms-perm'); if(!box) return;
 const wrap=document.createElement('div'); wrap.className='room-card room-card-perm';
 const head=document.createElement('div'); head.className='room-card-head';
 head.innerHTML='<div class="room-card-title"><b></b><span class="room-card-sub"></span></div><span class="sala-tag"></span>';
 head.querySelector('b').textContent=info.title||n;
 head.querySelector('.room-card-sub').textContent=n;
 head.querySelector('.sala-tag').textContent=info.open?'Pública':'Convite';
 if(n===home){
  const badge=document.createElement('span'); badge.className='entrance-on'; badge.textContent='Entrada do site';
  head.appendChild(badge);
 }
 wrap.appendChild(head);
 const acts=document.createElement('div'); acts.className='room-card-actions';
 const open=document.createElement('a'); open.className='btn-open'; open.textContent='Abrir'; open.href=openRoomHref(n, false); open.target='_blank'; open.rel='noopener';
 acts.appendChild(open);
 if(n!==home){
  const sh=document.createElement('button'); sh.type='button'; sh.className='okbtn sethome'; sh.textContent='Definir como entrada';
  sh.onclick=function(){ setRoomEntrance(n); };
  acts.appendChild(sh);
 }
 const del=document.createElement('button'); del.type='button'; del.className='del'; del.textContent='Apagar';
 del.onclick=function(){ deleteRoom(n); };
 acts.appendChild(del);
 wrap.appendChild(acts);
 if(!info.open){
  const pw=document.createElement('div'); pw.className='room-card-pw';
  pw.innerHTML='<input type="password" placeholder="Nova senha de amigos" autocomplete="new-password"/><button type="button" class="rst">Redefinir</button>';
  pw.querySelector('.rst').onclick=function(){ resetRoomFriendsPassword(n, pw.querySelector('input')); };
  wrap.appendChild(pw);
 }
 box.appendChild(wrap);
}

function paintRoomTemporary(n, info){
 const box=$('rooms-temp'); if(!box) return;
 const wrap=document.createElement('div'); wrap.className='room-card room-card-temp';
 const head=document.createElement('div'); head.className='room-card-head';
 head.innerHTML='<div class="room-card-title"><b></b><span class="sala-tag"></span><span class="room-ttl"></span></div>';
 head.querySelector('b').textContent=n;
 head.querySelector('.sala-tag').textContent=roomTagText(info, false);
 const rem=fmtRoomRemaining(info);
 var ttlEl=head.querySelector('.room-ttl');
 ttlEl.setAttribute('data-room-remain', n);
 ttlEl.textContent=rem?('⏱ '+rem):'';
 wrap.appendChild(head);
 const acts=document.createElement('div'); acts.className='room-card-actions';
 const copy=document.createElement('button'); copy.type='button'; copy.className='okbtn copy-link'; copy.textContent='Copiar link';
 const link=shellRoomLink(n);
 copy.onclick=function(){ copyTextToClipboard(link); };
 acts.appendChild(copy);
 const open=document.createElement('a'); open.className='btn-open'; open.textContent='Abrir'; open.href=openRoomHref(n, false); open.target='_blank'; open.rel='noopener';
 acts.appendChild(open);
 const del=document.createElement('button'); del.type='button'; del.className='del'; del.textContent='Apagar';
 del.onclick=function(){ deleteRoom(n); };
 acts.appendChild(del);
 wrap.appendChild(acts);
 box.appendChild(wrap);
}

function roomFormType(){ const t=document.querySelector('input[name="rtype"]:checked'); return t?t.value:'def'; }
function resetRoomCreateForm(){
 if($('rd')) $('rd').value='';
 if($('rn')){ $('rn').value=''; delete $('rn').dataset.slugReady; }
 if($('rp')) $('rp').value='';
 if($('rhost')) $('rhost').checked=false;
 if($('rhost-wrap')) $('rhost-wrap').hidden=true;
 if($('rhost-nick')) $('rhost-nick').value='';
 if($('rhost-pw')) $('rhost-pw').value='';
 if($('rtype-def')) $('rtype-def').checked=true;
 if($('room-msg')) $('room-msg').textContent='';
 syncRoomForm();
}
function openRoomCreateDlg(){
 if($('room-create-done')) $('room-create-done').hidden=true;
 if($('room-create-form')) $('room-create-form').hidden=false;
 resetRoomCreateForm();
 if($('room-create-dlg')) $('room-create-dlg').hidden=false;
}
function closeRoomCreateDlg(){
 if($('room-create-dlg')) $('room-create-dlg').hidden=true;
}
function showRoomCreated(createdId, title, typeMsg){
 const link=shellRoomLink(createdId);
 if($('room-create-form')) $('room-create-form').hidden=true;
 if($('room-done-msg')) $('room-done-msg').textContent='Sala "'+(title||createdId)+'" criada'+typeMsg;
 if($('room-done-link')){ $('room-done-link').textContent=link; $('room-done-link').dataset.href=link; }
 if($('room-create-done')) $('room-create-done').hidden=false;
}

async function loadGuests(){
 const box=$('guests'); if(!box) return;
 try{await refreshReg();}catch(e){if(!box.dataset.ok) box.textContent='Serviço de convites ainda não está no ar.';return;}
 const b=bucket();
 let names=[...new Set(Object.keys(b.guests).concat(Object.keys(b.pending),Object.keys(b.denied),Object.keys(b.blocked)))];
 const registered=new Set((await api('/.groups/'+GROUP+'/.users/'))||[]);
 names=names.filter(n=>!b.blocked[n]&&(b.pending[n]||b.denied[n]||!registered.has(n))); sortNickList(names,b,'guests');
 const gk='g:'+SORT.guests+':'+names.map(n=>(b.pending[n]&&'p'||b.denied[n]&&'d'||b.blocked[n]&&'b'||'g')+n).join('|');
 if(gk===loadGuests._k) return; loadGuests._k=gk; box.dataset.ok='1';
 box.innerHTML='';
 if(!names.length){box.textContent='Ninguém entrou ainda com a senha dos amigos.';return;}
 names.forEach(name=>{
  let st='guest';
  if(b.pending[name]) st='pending';
  if(b.denied[name]) st='denied';
  if(b.blocked[name]) st='blocked';
  const row=document.createElement('div'); row.className='guest-row';
  const lab=document.createElement('b'); lab.textContent=name;
  const tag=document.createElement('span'); tag.className='tag tag-'+st;
  tag.textContent={guest:'convite',pending:'cadastro pendente',denied:'negado',blocked:'bloqueado'}[st];
  const acts=document.createElement('div'); acts.className='acts';
  function add(cls,label,fn){const bt=document.createElement('button'); bt.type='button'; bt.className=cls; bt.textContent=label; bt.onclick=fn; acts.appendChild(bt);}
  async function go(path){try{await reg(path,{group:GROUP,user:name}); loadUsers._k=null; loadGuests._k=null; if(loadBlocked) loadBlocked._k=null; await loadUsers(); await loadGuests(); await loadBlocked();}catch(e){uiMsg(e.message);}}
  if(st==='guest'||st==='pending') add('reg','Cadastrar', async()=>{
   if(!await uiConfirm('Cadastrar '+name+' com senha Mudar@123? No primeiro login ela troca.')) return;
   try{await reg('/quick',{group:GROUP,user:name,permissions:'present'}); loadUsers._k=null; loadGuests._k=null; if(loadBlocked) loadBlocked._k=null; await loadUsers(); await loadGuests(); await loadBlocked();}catch(e){uiMsg(e.message);}
  });
  if(st==='pending'){ add('okbtn','Aprovar',()=>go('/approve')); add('deny','Negar',async()=>{if(await uiConfirm('Negar e bloquear o nick '+name+'?')) go('/deny');}); }
  if(st==='guest') add('blk','Bloquear',async()=>{if(await uiConfirm('Bloquear '+name+'? Ele não entra mais até desbloquear. A conta não é apagada.')) go('/block');});
  add('ghost','Excluir',async()=>{if(await uiConfirm('Excluir '+name+' por completo? A conta some e o nick fica livre de novo.')) go('/forget');});
  const meta=document.createElement('span'); meta.className='hint'; meta.textContent=fmtSeen(name,GROUP,Object.assign({},b.guests[name]||{},(b.seen||{})[name]||{}));
  row.appendChild(lab); row.appendChild(tag); row.appendChild(meta); row.appendChild(acts); box.appendChild(row);
 });
}

async function loadBlocked(){
 const box=$('blocked'); if(!box) return;
 try{await refreshReg();}catch(e){if(!box.dataset.ok) box.textContent='Serviço de convites ainda não está no ar.';return;}
 const b=bucket();
 const names=Object.keys(b.blocked||{}); sortNickList(names,b,'blocked');
 const key='b:'+SORT.blocked+':'+names.join('|');
 if(key===loadBlocked._k) return; loadBlocked._k=key; box.dataset.ok='1';
 box.innerHTML='';
 if(!names.length){box.textContent='Ninguém bloqueado.';return;}
 names.forEach(name=>{
  const row=document.createElement('div'); row.className='guest-row';
  const lab=document.createElement('b'); lab.textContent=name;
  const tag=document.createElement('span'); tag.className='tag tag-blocked'; tag.textContent='bloqueado';
  const acts=document.createElement('div'); acts.className='acts';
  const un=document.createElement('button'); un.type='button'; un.className='okbtn'; un.textContent='Desbloquear';
  un.onclick=async()=>{ if(!await uiConfirm('Desbloquear '+name+'? A conta continua existindo e o nick segue reservado. Ele volta a poder entrar com a senha da conta.')) return;
   try{await reg('/unblock',{group:GROUP,user:name}); loadUsers._k=null; loadBlocked._k=null; await loadUsers(); await loadGuests(); await loadBlocked();}catch(e){uiMsg(e.message);} };
  acts.appendChild(un);
  const bt=document.createElement('button'); bt.type='button'; bt.className='del'; bt.textContent='Excluir usuário';
  bt.onclick=async()=>{ if(!await uiConfirm('Excluir '+name+' por completo? A conta some e o nick fica livre de novo para qualquer um usar.')) return;
   try{await reg('/forget',{group:GROUP,user:name}); loadUsers._k=null; loadGuests._k=null; loadBlocked._k=null; loadUsers._k=null; loadGuests._k=null; if(loadBlocked) loadBlocked._k=null; await loadUsers(); await loadGuests(); await loadBlocked(); await loadBlocked();}catch(e){uiMsg(e.message);} };
  acts.appendChild(bt);
  const meta=document.createElement('span'); meta.className='hint'; meta.textContent=fmtSeen(name,GROUP,Object.assign({},b.blocked[name]||{},(b.seen||{})[name]||{}));
  row.appendChild(lab); row.appendChild(tag); row.appendChild(meta); row.appendChild(acts); box.appendChild(row);
 });
}
async function loadTemps(){
 const box=$('temps'); if(!box) return;
 try{await refreshReg();}catch(e){if(!box.dataset.ok) box.textContent='Serviço fora.';return;}
 let openIds=null;
 try{ const rooms=await fetch('/spartan-api/rooms',{cache:'no-store'}).then(function(r){return r.json();}); openIds={}; (rooms||[]).forEach(function(r){ if(r&&r.open) openIds[r.id]=1; }); }catch(e){}
 const rows=[];
 Object.keys(registry||{}).forEach(function(gid){ if(openIds && !openIds[gid]) return; const temps=(registry[gid]||{}).temps||{}; Object.keys(temps).forEach(function(name){rows.push({gid:gid,name:name,rec:temps[name]||{}});});});
 sortItems(rows,'temps');
 const key='t:'+SORT.temps+':'+rows.map(function(r){return r.gid+':'+r.name+':'+(r.rec.last||'')+':'+(r.rec.ip||'');}).join('|');
 if(key===loadTemps._k) return; loadTemps._k=key; box.dataset.ok='1';
 box.innerHTML='';
 if(!rows.length){box.textContent='Ninguém entrou ainda em sala sem senha.';return;}
 rows.forEach(function(item){
  const name=item.name, rec=item.rec, gid=item.gid;
  const el=document.createElement('div'); el.className='guest-row';
  const lab=document.createElement('b'); lab.textContent=name;
  const tag=document.createElement('span'); tag.className='tag tag-guest'; tag.textContent='temporário';
  const meta=document.createElement('span'); meta.className='hint'; meta.textContent='sala '+gid+(rec.ip?(' · IP '+rec.ip):'')+' · visto '+fmtQuando(rec.last||rec.first||'');
  el.appendChild(lab); el.appendChild(tag); el.appendChild(meta); box.appendChild(el);
 });
}
async function loadLogs(){
 const box=$('logs'); if(!box) return;
 try{
  const data=await reg('/access-log?limit=400');
  LOG_CACHE=(data&&data.entries)||[];
  const key='L:'+LOG_CACHE.length+':'+(LOG_CACHE[0]&&(LOG_CACHE[0].quando+LOG_CACHE[0].nick+LOG_CACHE[0].ip)||'')+':'+(($('log-tipo')&&$('log-tipo').value)||'')+':'+(($('log-nick')&&$('log-nick').value)||'')+':'+(($('log-ip')&&$('log-ip').value)||'');
  if(key===loadLogs._k){ paintLogs(); return; }
  loadLogs._k=key;
  paintLogs();
 }catch(e){
  if(!box.dataset.ok) box.textContent='Não deu para ler os logs.';
 }
}
var NET_CACHE=[];
function netPhaseLabel(p){return ({drop:'Queda',recovered:'Recuperou',gone:'Caiu de vez'})[p]||p||'—';}
function netMatchesFilter(e){
 var nick=((($('net-nick')&&$('net-nick').value)||'').trim().toLowerCase());
 var sala=((($('net-sala')&&$('net-sala').value)||'').trim().toLowerCase());
 var ip=((($('net-ip')&&$('net-ip').value)||'').trim().toLowerCase());
 if(nick && String(e.nick||'').toLowerCase().indexOf(nick)<0) return false;
 if(sala && String(e.sala||'').toLowerCase().indexOf(sala)<0) return false;
 if(ip && String(e.ip||'').toLowerCase().indexOf(ip)<0) return false;
 return true;
}
function paintNetLogs(){
 const box=$('net-log'); if(!box) return;
 const entries=NET_CACHE.filter(netMatchesFilter);
 box.innerHTML='';
 if(!NET_CACHE.length){box.textContent='Nenhuma oscilação registada ainda.';return;}
 if(!entries.length){box.textContent='Nenhum resultado com estes filtros.';return;}
 entries.forEach(function(e){
  const el=document.createElement('div'); el.className='guest-row';
  const lab=document.createElement('b'); lab.textContent=e.nick||'(sem nick)';
  const tag=document.createElement('span'); tag.className='tag tag-guest'; tag.textContent=netPhaseLabel(e.phase);
  const meta=document.createElement('span'); meta.className='hint';
  var bits=[];
  bits.push(fmtQuando(e.quando)||'');
  if(e.sala) bits.push('sala '+e.sala);
  if(e.ip) bits.push('IP '+e.ip);
  if(e.duration_ms) bits.push((e.duration_ms/1000).toFixed(1)+' s');
  if(e.code!=null && e.code!=='') bits.push('WS '+e.code);
  if(e.reason) bits.push(String(e.reason));
  meta.textContent=bits.filter(Boolean).join(' · ');
  el.appendChild(lab); el.appendChild(tag); el.appendChild(meta); box.appendChild(el);
 });
}
async function loadNetLogs(){
 const box=$('net-log'); if(!box) return;
 try{
  const data=await reg('/net-log?limit=400');
  NET_CACHE=(data&&data.entries)||[];
  const key='N:'+NET_CACHE.length+':'+(NET_CACHE[0]&&(NET_CACHE[0].quando+NET_CACHE[0].nick+NET_CACHE[0].ip)||'')+':'+(($('net-nick')&&$('net-nick').value)||'')+':'+(($('net-sala')&&$('net-sala').value)||'')+':'+(($('net-ip')&&$('net-ip').value)||'');
  if(key===loadNetLogs._k){ paintNetLogs(); return; }
  loadNetLogs._k=key;
  paintNetLogs();
 }catch(e){
  if(!box.dataset.ok) box.textContent='Não deu para ler as oscilações.';
 }
}
function applyPanelScope(){
 document.documentElement.classList.toggle('panel-mod', PANEL_SCOPE==='mod');
 document.querySelectorAll('.tab').forEach(function(b){
  if(PANEL_SCOPE==='mod'){
   b.hidden=b.dataset.tab!=='servers';
   b.classList.toggle('on', b.dataset.tab==='servers');
  } else b.hidden=false;
 });
 ['tab-users','tab-guests','tab-blocked','tab-temps','tab-logs','tab-net','tab-rooms','tab-servers'].forEach(function(id){
  var el=$(id); if(!el) return;
  if(PANEL_SCOPE==='mod') el.hidden=id!=='tab-servers';
 });
 if(PANEL_SCOPE==='mod' && $('tab-servers')) $('tab-servers').hidden=false;
}
async function afterLogin(){
 if(!PANEL_SCOPE){
  try{
   var j=await reg('/can-panel',{user:user,password:pass});
   PANEL_SCOPE=j.scope||(j.ok?'admin':'');
  }catch(e){ PANEL_SCOPE=''; }
 }
 if(!PANEL_SCOPE) throw new Error('Usuário ou senha inválidos');
 applyPanelScope();
 await loadSite();
 document.documentElement.classList.remove('admin-gate');
 $('login-box').hidden=true; $('panel').hidden=false;
 $('who').textContent='Logado: '+user+(PANEL_SCOPE==='mod'?' (moderador)':'');
 if(PANEL_SCOPE==='admin'){
  try{ await loadUsers(); }catch(e){ uiMsg(e.message); }
  try{ await loadRooms(); }catch(e){}
  try{ await loadGuests(); }catch(e){}
  try{ await loadBlocked(); }catch(e){}
  try{ await loadTemps(); }catch(e){}
  try{ await loadLogs(); }catch(e){}
  try{ await loadNetLogs(); }catch(e){}
 }
 try{ await loadServers(); }catch(e){}
}
$('btn-login').onclick=async()=>{
 user=($('u').value||'').trim().toLowerCase(); $('u').value=user; pass=$('p').value; $('login-err').textContent='';
 try{
  const r=await fetch(REG+'/panel-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:user,password:pass})});
  let data=null; try{data=await r.json();}catch(e){data={};}
  if(!r.ok) throw new Error((data&&data.error)||'Usuário ou senha inválidos');
  PANEL_SCOPE=(data&&data.scope)||'admin';
  sessionStorage.setItem('spartanAdmin',JSON.stringify({user:user,pass:pass}));
  try{localStorage.removeItem('spartanAdminHandoff');}catch(e){}
  await afterLogin();
 }catch(e){$('login-err').textContent=e.message;}
};
$('p').addEventListener('keydown',e=>{if(e.key==='Enter')$('btn-login').click();});
$('btn-out').onclick=()=>{try{sessionStorage.removeItem('spartanAdmin');}catch(e){} if(adminInShell()){ adminCloseShell(); return; } location.href='/#/';};
if(adminIsEmbed()){ document.documentElement.classList.add('admin-embed'); document.querySelector('footer.signature')&&document.querySelector('footer.signature').classList.add('invisible'); }
if(adminInShell()) document.documentElement.classList.add('admin-in-shell');
document.addEventListener('keydown', function(e){ if(e.key==='Escape' && adminInShell()) adminCloseShell(); });
$('btn-create').onclick=async()=>{
 const n=($('nu').value||'').trim().toLowerCase(), perm=$('nperm').value; $('nu').value=n; $('create-msg').textContent='';
 if(!n){$('create-msg').textContent='Informe o nick';return;}
 try{
  await reg('/quick',{group:GROUP,user:n,permissions:perm});
  $('nu').value=''; $('create-msg').textContent='Usuário '+n+' criado. Senha inicial Mudar@123 — avise o nick; no 1º login ela troca.';
  await loadUsers();
 }catch(e){$('create-msg').textContent=e.message;}
};
function syncRoomForm(){
 const type=roomFormType();
 const invite=type!=='pub24';
 const ttl=type==='inv24'||type==='pub24';
 if($('rp-wrap')) $('rp-wrap').hidden=!invite;
 if($('rp')){ if(!invite) $('rp').value=''; }
 const rn=$('rn'), regen=$('rn-regen'), lbl=$('rn-label'), hint=$('rn-hint');
 if(rn){
  if(ttl){
   rn.readOnly=true;
   rn.classList.add('slug-auto');
   if(lbl) lbl.textContent='Código do link (24h)';
   if(regen) regen.hidden=false;
   if(hint) hint.hidden=false;
   if(!rn.value || !rn.dataset.slugReady) spartanAssignRoomSlug(false);
  }else{
   rn.readOnly=false;
   rn.classList.remove('slug-auto');
   if(lbl) lbl.textContent='Endereço na URL (minúsculo, sem espaço)';
   if(regen) regen.hidden=true;
   if(hint) hint.hidden=true;
   if(rn.dataset.slugReady){ rn.value=''; delete rn.dataset.slugReady; }
  }
 }
 if($('rhost-block')) $('rhost-block').hidden=!ttl;
 if(!ttl){
  if($('rhost')) $('rhost').checked=false;
  if($('rhost-wrap')) $('rhost-wrap').hidden=true;
 }
}
var spartanSlugPool=new Set();
async function spartanLoadSlugPool(){
 spartanSlugPool.clear();
 try{ (await reg('/rooms?all=1')||[]).forEach(function(r){ if(r&&r.id) spartanSlugPool.add(r.id); }); }catch(e){}
 try{ (await api('/.groups/')||[]).forEach(function(id){ spartanSlugPool.add(id); }); }catch(e){}
}
function spartanMakeRoomSlug(){
 var chars='abcdefghijklmnopqrstuvwxyz0123456789', i, s, buf;
 for(i=0;i<300;i++){
  s='';
  buf=new Uint8Array(15);
  crypto.getRandomValues(buf);
  for(var j=0;j<15;j++) s+=chars[buf[j]%chars.length];
  if(!spartanSlugPool.has(s)){ spartanSlugPool.add(s); return s; }
 }
 throw new Error('Não deu para gerar código único. Tente de novo.');
}
async function spartanAssignRoomSlug(forceNew){
 var rn=$('rn');
 if(!rn) return;
 await spartanLoadSlugPool();
 if(forceNew && rn.value) spartanSlugPool.delete(rn.value);
 rn.value=spartanMakeRoomSlug();
 rn.dataset.slugReady='1';
}
document.querySelectorAll('input[name="rtype"]').forEach(function(el){ el.onchange=function(){ syncRoomForm(); }; });
$('rn-regen')&&($('rn-regen').onclick=async function(){ try{ await spartanAssignRoomSlug(true); }catch(e){ uiMsg(e.message); } });
$('rhost')&&($('rhost').onchange=function(){
 if($('rhost-wrap')) $('rhost-wrap').hidden=!$('rhost').checked;
});
$('btn-room-open')&&($('btn-room-open').onclick=openRoomCreateDlg);
$('room-create-close')&&($('room-create-close').onclick=closeRoomCreateDlg);
$('room-create-cancel')&&($('room-create-cancel').onclick=closeRoomCreateDlg);
$('room-done-close')&&($('room-done-close').onclick=closeRoomCreateDlg);
$('room-done-copy')&&($('room-done-copy').onclick=function(){
 const el=$('room-done-link');
 copyTextToClipboard((el&&el.dataset.href)||(el&&el.textContent)||'');
});
if($('room-create-dlg')){
 $('room-create-dlg').addEventListener('click',function(e){ if(e.target===$('room-create-dlg')) closeRoomCreateDlg(); });
}
syncRoomForm();
$('btn-room').onclick=async()=>{
 const type=roomFormType();
 const open=type==='pub24';
 const ttl=type==='inv24'||type==='pub24';
 if(ttl){
  try{ if(!$('rn').value || !$('rn').dataset.slugReady) await spartanAssignRoomSlug(false); }catch(e){ if($('room-msg')) $('room-msg').textContent=e.message; return; }
 }
 let slug=$('rn').value.trim().toLowerCase().replace(/[^a-z0-9-]/g,'');
 const title=$('rd').value.trim()||slug;
 const wp=$('rp')?$('rp').value:'';
 const wantHost=ttl && $('rhost')&&$('rhost').checked;
 const hostNick=(($('rhost-nick')&&$('rhost-nick').value)||'').trim().toLowerCase();
 const hostPw=$('rhost-pw')?$('rhost-pw').value:'';
 if($('room-msg')) $('room-msg').textContent='';
 if(!slug){ if($('room-msg')) $('room-msg').textContent=ttl?'Gere o código do link':'Digite o endereço da sala'; return; }
 if(!open && (!wp || wp.length<8)){ if($('room-msg')) $('room-msg').textContent='Senha de convite com no mínimo 8 caracteres'; return; }
 if(wantHost && (!hostNick || hostPw.length<8)){ if($('room-msg')) $('room-msg').textContent='Anfitrião precisa de nick e senha (mínimo 8)'; return; }
 try{
  const body={id:slug,title:title,open:open,ttl:!!ttl,host:!!wantHost};
  if(!open) body.friends_password=wp;
  if(wantHost){ body.host_nick=hostNick; body.host_password=hostPw; }
  const res=await reg('/create-room', body);
  const createdId=(res&&res.id)||slug;
  let typeMsg='';
  if(open) typeMsg=' (pública, 24h';
  else if(ttl) typeMsg=' (convite, 24h';
  else typeMsg=' (convite definitiva';
  if(wantHost) typeMsg+=', anfitrião '+hostNick;
  typeMsg+=')';
  loadRooms._k=null; await loadRooms();
  showRoomCreated(createdId, title||createdId, typeMsg);
 }catch(e){ if($('room-msg')) $('room-msg').textContent=e.message; }
};
function reloadServers(){ loadServers._k=null; return loadServers(); }
function roleLabelServer(r){
 if(r==='admin') return 'Admin';
 if(r==='mod') return 'Moderador';
 return 'Membro';
}
function filterNickList(list, q){
 q=String(q||'').trim().toLowerCase();
 if(!q) return list;
 return list.filter(function(item){
  var n=typeof item==='string'?item:(item.nick||'');
  return String(n).toLowerCase().indexOf(q)>=0;
 });
}
var memDlg={sid:'', title:''};
var userSrvDlg={nick:''};
function closeMemDlgs(){
 if($('mem-dlg')) $('mem-dlg').hidden=true;
 if($('mem-add-dlg')) $('mem-add-dlg').hidden=true;
 if($('user-srv-dlg')) $('user-srv-dlg').hidden=true;
}
function paintMemList(){
 var box=$('mem-dlg-list'); if(!box) return;
 var q=$('mem-dlg-q')&&$('mem-dlg-q').value;
 var rows=[];
 var seen={};
 (memDlg.members||[]).forEach(function(m){
  if(!m||!m.nick) return;
  seen[m.nick]=true;
  rows.push({nick:m.nick, role:m.role||'member', has:true});
 });
 (memDlg.addable||[]).forEach(function(nick){
  nick=String(nick||'').toLowerCase();
  if(!nick || seen[nick]) return;
  rows.push({nick:nick, role:'', has:false});
 });
 rows=filterNickList(rows, q);
 rows.sort(function(a,c){
  if(a.has!==c.has) return a.has? -1:1;
  return String(a.nick).localeCompare(String(c.nick),'pt',{sensitivity:'base'});
 });
 box.innerHTML='';
 if(!rows.length){
  var p=document.createElement('p'); p.className='hint';
  p.textContent=q?'Nenhum cadastrado com esse nome.':'Nenhum usuário cadastrado além dos que já estão neste servidor.';
  box.appendChild(p); return;
 }
 rows.forEach(function(m){
  var row=document.createElement('div'); row.className='mem-row';
  var lab=document.createElement('span');
  lab.textContent=m.has? (m.nick+' · '+roleLabelServer(m.role)) : (m.nick+' · sem acesso');
  var btn=document.createElement('button'); btn.type='button';
  if(m.has){
   btn.className='ghost'; btn.textContent='Remover';
   btn.onclick=function(){
    uiConfirm('Tirar '+m.nick+' deste servidor? Se estiver na call, cai na hora.').then(function(ok2){
     if(!ok2) return;
     reg('/server-member-remove',{user:user,password:pass,server:memDlg.sid,nick:m.nick}).then(function(){
      uiMsg('Removeu '+m.nick+'.'); reloadServers(); refreshMemDlg();
     }).catch(function(e){ uiMsg(e.message); });
    });
   };
  } else {
   btn.className='okbtn'; btn.textContent='Adicionar';
   btn.onclick=function(){
    reg('/server-member-add',{user:user,password:pass,server:memDlg.sid,nick:m.nick}).then(function(){
     uiMsg('Adicionou '+m.nick+'.'); reloadServers(); refreshMemDlg();
    }).catch(function(e){ uiMsg(e.message); });
   };
  }
  row.appendChild(lab); row.appendChild(btn); box.appendChild(row);
 });
}
function refreshMemDlg(){
 if(!memDlg.sid) return;
 return Promise.all([
  reg('/server-view',{user:user,password:pass,server:memDlg.sid}),
  reg('/server-addable',{user:user,password:pass,server:memDlg.sid})
 ]).then(function(pair){
  var d=pair[0]||{};
  memDlg.members=d.members||[];
  memDlg.addable=(pair[1]&&pair[1].users)||[];
  if($('mem-dlg-title')) $('mem-dlg-title').textContent='Usuários · '+(d.title||d.id);
  paintMemList();
 }).catch(function(e){ uiMsg(e.message); });
}
function openMemDlg(d){
 memDlg={sid:d.id, title:d.title||d.id};
 if($('mem-dlg-q')) $('mem-dlg-q').value='';
 if($('mem-dlg')) $('mem-dlg').hidden=false;
 refreshMemDlg();
}
function paintAddList(users){
 var box=$('mem-add-list'); if(!box) return;
 var q=$('mem-add-q')&&$('mem-add-q').value;
 var rows=filterNickList(users||[], q);
 box.innerHTML='';
 if(!rows.length){
  var p=document.createElement('p'); p.className='hint'; p.textContent='Ninguém para adicionar.'; box.appendChild(p); return;
 }
 rows.forEach(function(nick){
  var row=document.createElement('div'); row.className='mem-row';
  var lab=document.createElement('span'); lab.textContent=nick;
  var add=document.createElement('button'); add.type='button'; add.textContent='Adicionar';
  add.onclick=function(){
   reg('/server-member-add',{user:user,password:pass,server:memDlg.sid,nick:nick}).then(function(){
    uiMsg('Adicionou '+nick+'.'); reloadServers(); refreshAddDlg(); refreshMemDlg();
   }).catch(function(e){ uiMsg(e.message); });
  };
  row.appendChild(lab); row.appendChild(add); box.appendChild(row);
 });
}
function refreshAddDlg(){
 if(!memDlg.sid) return;
 return reg('/server-addable',{user:user,password:pass,server:memDlg.sid}).then(function(j){
  memDlg.addable=j.users||[];
  paintAddList(memDlg.addable);
 }).catch(function(e){ uiMsg(e.message); });
}
function openAddDlg(){
 if($('mem-add-q')) $('mem-add-q').value='';
 if($('mem-add-title')) $('mem-add-title').textContent='Adicionar · '+(memDlg.title||memDlg.sid);
 if($('mem-add-dlg')) $('mem-add-dlg').hidden=false;
 refreshAddDlg();
}
function paintUserSrvList(rows){
 var box=$('user-srv-list'); if(!box) return;
 var q=$('user-srv-q')&&$('user-srv-q').value;
 var list=rows||[];
 if(q){
  var qq=String(q).toLowerCase();
  list=list.filter(function(s){ return ((s.title||'')+' '+(s.id||'')).toLowerCase().indexOf(qq)>=0; });
 }
 box.innerHTML='';
 if(!list.length){
  var p=document.createElement('p'); p.className='hint'; p.textContent='Nenhum servidor.'; box.appendChild(p); return;
 }
 list.forEach(function(s){
  var row=document.createElement('div'); row.className='mem-row';
  var lab=document.createElement('span');
  lab.textContent=(s.title||s.id)+(s.has?(' · '+roleLabelServer(s.role)):' · sem acesso');
  var btn=document.createElement('button'); btn.type='button';
  if(s.has){
   btn.className='ghost'; btn.textContent='Remover';
   btn.onclick=function(){
    uiConfirm('Tirar '+userSrvDlg.nick+' de '+(s.title||s.id)+'?').then(function(ok2){
     if(!ok2) return;
     reg('/server-member-remove',{user:user,password:pass,server:s.id,nick:userSrvDlg.nick}).then(function(){
      uiMsg('Removeu o acesso.'); reloadServers(); refreshUserSrvDlg();
     }).catch(function(e){ uiMsg(e.message); });
    });
   };
  } else {
   btn.textContent='Adicionar';
   btn.onclick=function(){
    reg('/server-member-add',{user:user,password:pass,server:s.id,nick:userSrvDlg.nick}).then(function(){
     uiMsg('Adicionou o acesso.'); reloadServers(); refreshUserSrvDlg();
    }).catch(function(e){ uiMsg(e.message); });
   };
  }
  row.appendChild(lab); row.appendChild(btn); box.appendChild(row);
 });
}
function refreshUserSrvDlg(){
 if(!userSrvDlg.nick) return;
 return reg('/user-servers',{user:user,password:pass,nick:userSrvDlg.nick}).then(function(j){
  userSrvDlg.servers=j.servers||[];
  paintUserSrvList(userSrvDlg.servers);
 }).catch(function(e){ uiMsg(e.message); });
}
function openUserServers(nick){
 userSrvDlg={nick:nick};
 if($('user-srv-q')) $('user-srv-q').value='';
 if($('user-srv-title')) $('user-srv-title').textContent='Servidores · '+nick;
 if($('user-srv-dlg')) $('user-srv-dlg').hidden=false;
 refreshUserSrvDlg();
}
function bindMemDlgs(){
 if(bindMemDlgs._ok) return; bindMemDlgs._ok=true;
 [['mem-dlg','mem-dlg-close'],['mem-add-dlg','mem-add-close'],['user-srv-dlg','user-srv-close']].forEach(function(pair){
  var dlg=$(pair[0]), close=$(pair[1]);
  if(dlg && !dlg.dataset.bound){
   dlg.dataset.bound='1';
   dlg.addEventListener('click', function(ev){ if(ev.target===dlg) dlg.hidden=true; });
  }
  if(close) close.onclick=function(){ if(dlg) dlg.hidden=true; };
 });
 if($('mem-dlg-q')) $('mem-dlg-q').addEventListener('input', function(){ paintMemList(); });
 if($('mem-add-q')) $('mem-add-q').addEventListener('input', function(){ paintAddList(memDlg.addable||[]); });
 if($('user-srv-q')) $('user-srv-q').addEventListener('input', function(){ paintUserSrvList(userSrvDlg.servers||[]); });
 if($('mem-dlg-add')) $('mem-dlg-add').hidden=true;
}
function serverViewKey(d){
 return JSON.stringify({
  id:d.id, title:d.title, official:!!d.official, my_role:d.my_role||'',
  member_count:d.member_count||0, invite:d.invite||'',
  pending:(d.pending||[]).map(function(p){ return p.nick; }).sort(),
  members:(d.members||[]).map(function(m){ return [m.nick,m.role]; }).sort(),
  channels:(d.channels||[]).map(function(c){ return [c.id,c.title,c.kind,c.category||'',c.group||'',!!c.locked]; })
 });
}
function reorderServerChans(d, fromId, toId){
 var kindOf=function(id){
  var ch=(d.channels||[]).filter(function(c){ return c.id===id; })[0];
  return ch && ch.kind==='text' ? 'text' : 'voice';
 };
 if(kindOf(fromId)!==kindOf(toId)) return;
 var order=(d.channels||[]).map(function(c){ return c.id; });
 var i=order.indexOf(fromId), j=order.indexOf(toId);
 if(i<0 || j<0 || i===j) return;
 var item=order.splice(i,1)[0];
 if(i<j) j--;
 order.splice(j, 0, item);
 loadServers._k=null;
 reg('/server-channel-reorder',{user:user,password:pass,server:d.id,order:order}).then(function(){ reloadServers(); }).catch(function(e){ uiMsg(e.message); });
}
function paintServerChanRow(d, ch){
 var row=document.createElement('div');
 row.className='server-chan-row';
 var grip=document.createElement('span');
 grip.className='server-chan-grip';
 grip.title='Arrastar para reordenar';
 grip.textContent='⋮⋮';
 grip.draggable=true;
 grip.addEventListener('dragstart', function(ev){
  ev.dataTransfer.setData('text/plain', ch.id);
  ev.dataTransfer.effectAllowed='move';
  row.classList.add('dragging');
 });
 grip.addEventListener('dragend', function(){ row.classList.remove('dragging'); });
 row.addEventListener('dragover', function(ev){ ev.preventDefault(); row.classList.add('drop'); });
 row.addEventListener('dragleave', function(){ row.classList.remove('drop'); });
 row.addEventListener('drop', function(ev){
  ev.preventDefault(); row.classList.remove('drop');
  var from=ev.dataTransfer.getData('text/plain');
  if(from) reorderServerChans(d, from, ch.id);
 });
 var lab=document.createElement('span');
 lab.textContent=ch.title||ch.id;
 var acts=document.createElement('div');
 acts.className='server-chan-acts';
 var ren=document.createElement('button');
 ren.type='button';
 ren.textContent='Renomear';
 ren.onclick=function(){
  uiPrompt('Novo nome de '+(ch.title||ch.id)+':').then(function(t){
   t=(t||'').trim(); if(!t) return;
   reg('/server-channel-rename',{user:user,password:pass,server:d.id,channel:ch.id,title:t}).then(function(){ reloadServers(); }).catch(function(e){ uiMsg(e.message); });
  });
 };
 acts.appendChild(ren);
 if(!ch.locked){
  var del=document.createElement('button');
  del.type='button';
  del.className='ghost';
  del.textContent='Apagar';
  del.onclick=function(){
   uiConfirm('Apagar a sala '+(ch.title||ch.id)+'?').then(function(ok2){
    if(!ok2) return;
    reg('/server-channel-delete',{user:user,password:pass,server:d.id,channel:ch.id}).then(function(){ reloadServers(); }).catch(function(e){ uiMsg(e.message); });
   });
  };
  acts.appendChild(del);
 }
 row.appendChild(grip); row.appendChild(lab); row.appendChild(acts);
 return row;
}
async function loadServers(){
 var box=$('servers-list'); if(!box) return;
 try{
  var list=await (await fetch(REG+'/servers?user='+encodeURIComponent(user),{cache:'no-store',headers:{'Authorization':authHeader(),'X-Spartan-Auth':authHeader()}})).json();
  var servers=(list&&list.servers)||[];
  var views=[], i;
  for(i=0;i<servers.length;i++){
   try{ views.push(await reg('/server-view',{user:user,password:pass,server:servers[i].id})); }
   catch(e){ views.push(Object.assign({}, servers[i], {channels:[], pending:[]})); }
  }
  var key=views.map(serverViewKey).join('\n');
  if(key===loadServers._k) return;
  loadServers._k=key;
  box.innerHTML='';
  views.forEach(function(d){
    var card=document.createElement('div');
    card.className='server-card';
    var head=document.createElement('div');
    head.className='server-card-head';
    var h=document.createElement('h3');
    h.textContent=d.title||d.id;
    head.appendChild(h);
    if(d.official){
     var badge=document.createElement('span');
     badge.className='server-badge';
     badge.textContent='oficial';
     head.appendChild(badge);
    }
    card.appendChild(head);
    var meta=document.createElement('p');
    meta.className='server-meta';
    var n=d.member_count||0;
    meta.textContent='Papel seu: '+(d.my_role||'—')+' · '+n+' membro'+(n===1?'':'s');
    card.appendChild(meta);
    if(d.invite){
     var inv=document.createElement('div');
     inv.className='server-invite';
     var inp=document.createElement('input');
     inp.type='text'; inp.readOnly=true; inp.className='server-invite-url';
     inp.value=location.origin+'/#/i/'+encodeURIComponent(d.invite);
     var copy=document.createElement('button'); copy.type='button'; copy.textContent='Copiar link';
     copy.onclick=function(){
      var v=inp.value;
      function ok(){ copy.textContent='Copiado'; setTimeout(function(){ copy.textContent='Copiar link'; }, 1200); }
      if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(ok).catch(function(){ inp.select(); document.execCommand('copy'); ok(); });
      else { inp.select(); document.execCommand('copy'); ok(); }
     };
     var rot=document.createElement('button'); rot.type='button'; rot.textContent='Trocar link';
     rot.onclick=function(){ reg('/server-invite-rotate',{user:user,password:pass,server:d.id}).then(function(){ reloadServers(); }).catch(function(e){ uiMsg(e.message); }); };
     inv.appendChild(inp); inv.appendChild(copy); inv.appendChild(rot);
     card.appendChild(inv);
    }
    var pendBox=document.createElement('div');
    pendBox.className='server-pending';
    (d.pending||[]).forEach(function(p){
     var row=document.createElement('div'); row.className='server-pend-row';
     var who=document.createElement('span'); who.textContent=p.nick+' pediu entrada';
     var ok=document.createElement('button'); ok.type='button'; ok.textContent='Aprovar';
     ok.onclick=function(){ reg('/server-approve',{user:user,password:pass,server:d.id,nick:p.nick}).then(function(){ reloadServers(); }).catch(function(e){ uiMsg(e.message); }); };
     var no=document.createElement('button'); no.type='button'; no.className='ghost'; no.textContent='Recusar';
     no.onclick=function(){ reg('/server-deny',{user:user,password:pass,server:d.id,nick:p.nick}).then(function(){ reloadServers(); }).catch(function(e){ uiMsg(e.message); }); };
     row.appendChild(who); row.appendChild(ok); row.appendChild(no); pendBox.appendChild(row);
    });
    if(pendBox.children.length) card.appendChild(pendBox);
    var cols=document.createElement('div');
    cols.className='server-cols';
    var textCol=document.createElement('div'); textCol.className='server-col';
    var th=document.createElement('h4'); th.textContent='Salas de texto'; textCol.appendChild(th);
    var voiceCol=document.createElement('div'); voiceCol.className='server-col';
    var vh=document.createElement('h4'); vh.textContent='Salas de voz'; voiceCol.appendChild(vh);
    var texts=(d.channels||[]).filter(function(c){ return c.kind==='text'; });
    var voices=(d.channels||[]).filter(function(c){ return c.kind!=='text'; });
    if(!texts.length){ var e1=document.createElement('p'); e1.className='server-col-empty'; e1.textContent='Nenhuma sala de texto.'; textCol.appendChild(e1); }
    else texts.forEach(function(ch){ textCol.appendChild(paintServerChanRow(d, ch)); });
    if(!voices.length){ var e2=document.createElement('p'); e2.className='server-col-empty'; e2.textContent='Nenhuma sala de voz.'; voiceCol.appendChild(e2); }
    else voices.forEach(function(ch){ voiceCol.appendChild(paintServerChanRow(d, ch)); });
    cols.appendChild(textCol); cols.appendChild(voiceCol);
    card.appendChild(cols);
    var tools=document.createElement('div');
    tools.className='server-tools';
    var usersBtn=document.createElement('button'); usersBtn.type='button'; usersBtn.className='okbtn'; usersBtn.textContent='Adicionar e remover usuários';
    usersBtn.onclick=function(){ openMemDlg(d); };
    tools.appendChild(usersBtn);
    var row1=document.createElement('div'); row1.className='server-tool-row';
    var chTitle=document.createElement('input'); chTitle.type='text'; chTitle.placeholder='Nome da nova sala';
    var chKind=document.createElement('select');
    chKind.innerHTML='<option value="text">Texto</option><option value="voice">Voz</option>';
    var chBtn=document.createElement('button'); chBtn.type='button'; chBtn.textContent='Criar sala';
    chBtn.onclick=function(){
     var t=(chTitle.value||'').trim(); if(!t) return;
     var kind=chKind.value, cat=kind==='voice'?'voz':'texto';
     reg('/server-channel',{user:user,password:pass,server:d.id,title:t,kind:kind,category:cat}).then(function(){ reloadServers(); }).catch(function(e){ uiMsg(e.message); });
    };
    row1.appendChild(chTitle); row1.appendChild(chKind); row1.appendChild(chBtn);
    tools.appendChild(row1);
    if(PANEL_SCOPE==='admin'){
     var row2=document.createElement('div'); row2.className='server-tool-row';
     var nickIn=document.createElement('select');
     var opt0=document.createElement('option'); opt0.value=''; opt0.textContent='Nick do moderador'; nickIn.appendChild(opt0);
     (d.members||[]).forEach(function(m){
      if(!m.nick || m.role==='admin') return;
      var o=document.createElement('option'); o.value=m.nick;
      o.textContent=m.nick+(m.role==='mod'?' (já é moderador)':'');
      nickIn.appendChild(o);
     });
     var modBtn=document.createElement('button'); modBtn.type='button'; modBtn.textContent='Tornar moderador';
     modBtn.onclick=function(){
      var nick=(nickIn.value||'').trim().toLowerCase(); if(!nick) return;
      reg('/server-mod',{user:user,password:pass,server:d.id,nick:nick,on:true}).then(function(){ uiMsg('Moderador no sidecar (na call continua Usuário).'); reloadServers(); }).catch(function(e){ uiMsg(e.message); });
     };
     row2.appendChild(nickIn); row2.appendChild(modBtn);
     tools.appendChild(row2);
    }
    if(!d.official && (PANEL_SCOPE==='admin' || d.my_role==='admin')){
     var delSrv=document.createElement('button'); delSrv.type='button'; delSrv.className='ghost'; delSrv.textContent='Apagar servidor';
     delSrv.onclick=function(){ uiConfirm('Apagar este servidor? As calls Galene não somem sozinhas.').then(function(ok2){ if(!ok2) return; reg('/server-delete',{user:user,password:pass,server:d.id}).then(function(){ reloadServers(); }).catch(function(e){ uiMsg(e.message); }); }); };
     tools.appendChild(delSrv);
    }
    card.appendChild(tools);
    box.appendChild(card);
  });
  bindMemDlgs();
 }catch(e){ if($('server-msg')) $('server-msg').textContent=e.message||'Não carregou.'; }
}
if($('btn-server-create')) $('btn-server-create').onclick=async function(){
 var title=($('server-title')&&$('server-title').value||'').trim();
 if(!title){ if($('server-msg')) $('server-msg').textContent='Dê um nome ao servidor.'; return; }
 try{
  await reg('/server-create',{user:user,password:pass,title:title});
  if($('server-title')) $('server-title').value='';
  if($('server-msg')) $('server-msg').textContent='';
  reloadServers();
 }catch(e){ if($('server-msg')) $('server-msg').textContent=e.message; }
};
document.querySelectorAll('.tab').forEach(b=>{
 b.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===b));
  $('tab-users').hidden=b.dataset.tab!=='users';
  $('tab-guests').hidden=b.dataset.tab!=='guests';
  $('tab-blocked').hidden=b.dataset.tab!=='blocked';
  $('tab-temps').hidden=b.dataset.tab!=='temps';
  if($('tab-logs')) $('tab-logs').hidden=b.dataset.tab!=='logs';
  if($('tab-net')) $('tab-net').hidden=b.dataset.tab!=='net';
  $('tab-rooms').hidden=b.dataset.tab!=='rooms';
  if($('tab-servers')) $('tab-servers').hidden=b.dataset.tab!=='servers';
  if(b.dataset.tab==='rooms'){ loadRooms._k=null; loadRooms(); }
  if(b.dataset.tab==='servers') loadServers();
  if(b.dataset.tab==='logs'){ loadLogs._k=null; loadLogs(); }
  if(b.dataset.tab==='net'){ loadNetLogs._k=null; loadNetLogs(); }
 };
});
try{
 let saved=null;
 try{saved=JSON.parse(localStorage.getItem('spartanAdminHandoff')||'null');}catch(e){}
 if(!(saved&&saved.user&&saved.pass)){
  try{saved=JSON.parse(sessionStorage.getItem('spartanAdmin')||'null');}catch(e){}
 }
 if(saved&&saved.user&&saved.pass){
  user=String(saved.user).trim().toLowerCase(); pass=saved.pass;
  sessionStorage.setItem('spartanAdmin',JSON.stringify({user:user,pass:pass}));
  try{localStorage.removeItem('spartanAdminHandoff');}catch(e){}
  afterLogin().catch(function(e){
   try{sessionStorage.removeItem('spartanAdmin');}catch(err){}
   user='';pass='';
   document.documentElement.classList.add('admin-gate');
   if($('login-box')) $('login-box').hidden=false;
   if($('panel')) $('panel').hidden=true;
   if($('login-err')) $('login-err').textContent=(e&&e.message)||'Não autenticou. Entre com o usuário admin (op da sala).';
  });
 }
}catch(e){}

document.querySelectorAll('.list-tools').forEach(function(bar){bar.addEventListener('click',function(e){var btn=e.target.closest('[data-sort]'); if(!btn) return; var tab=bar.getAttribute('data-tab'); SORT[tab]=btn.getAttribute('data-sort'); bar.querySelectorAll('[data-sort]').forEach(function(x){x.classList.toggle('on',x===btn);}); loadUsers._k=loadGuests._k=loadBlocked._k=loadTemps._k=null; if(tab==='users') loadUsers(); else if(tab==='guests') loadGuests(); else if(tab==='blocked') loadBlocked(); else if(tab==='temps') loadTemps();});});
setInterval(function(){ try{ if($('panel') && !$('panel').hidden){ if(PANEL_SCOPE==='admin'){ loadUsers().catch(function(){}); loadGuests().catch(function(){}); loadBlocked().catch(function(){}); loadTemps().catch(function(){}); if($('tab-logs') && !$('tab-logs').hidden) loadLogs().catch(function(){}); if($('tab-net') && !$('tab-net').hidden) loadNetLogs().catch(function(){}); if($('tab-rooms') && !$('tab-rooms').hidden) loadRooms().catch(function(){}); } if($('tab-servers') && !$('tab-servers').hidden) loadServers(); } }catch(e){} }, 8000);
['log-tipo','log-nick','log-ip'].forEach(function(id){
 var el=$(id); if(!el) return;
 el.addEventListener(id==='log-tipo'?'change':'input', function(){ loadLogs._k=null; paintLogs(); });
});
['net-nick','net-sala','net-ip'].forEach(function(id){
 var el=$(id); if(!el) return;
 el.addEventListener('input', function(){ loadNetLogs._k=null; paintNetLogs(); });
});
