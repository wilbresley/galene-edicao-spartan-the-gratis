'use strict';
function uiMsg(m){var t=document.getElementById('ui-toast'); if(!t) return; t.textContent=m; t.hidden=false; clearTimeout(window._uiT); window._uiT=setTimeout(function(){t.hidden=true;},3200);}
function uiDlg(msg,kind){return new Promise(function(resolve){var d=document.getElementById('ui-dlg'),i=document.getElementById('ui-dlg-input'),c=document.getElementById('ui-dlg-cancel'); if(!d){resolve(kind==='prompt'?null:true);return;} document.getElementById('ui-dlg-msg').textContent=msg; i.value=''; i.classList.toggle('is-off', kind!=='prompt'); c.classList.toggle('is-off', kind==='ok'); d.hidden=false; document.getElementById('ui-dlg-ok').onclick=function(){d.hidden=true; resolve(kind==='prompt'?i.value:true);}; c.onclick=function(){d.hidden=true; resolve(kind==='prompt'?null:false);};});}
function uiConfirm(m){return uiDlg(m,'confirm');}
function uiPrompt(m){return uiDlg(m,'prompt');}

const API='/spartan-api/gapi', REG='/spartan-api';
let GROUP='spartan', user='', pass='', registry={}, SITE={main:'spartan',home:'spartan'};
async function loadSite(){ try{ SITE=await (await fetch(REG+'/site',{cache:'no-store'})).json(); }catch(e){ SITE={main:'spartan',home:'spartan'}; } GROUP=SITE.main||'spartan'; var a=document.querySelector('.btn-back'); if(a) a.href='/group/'+encodeURIComponent(SITE.home||SITE.main||'spartan')+'/'; }
function authHeader(){return 'Basic '+btoa(unescape(encodeURIComponent(user+':'+pass)));}
async function api(path,opt){
 opt=opt||{};
 const hdr=Object.assign({'Authorization':authHeader(),'X-Spartan-Auth':authHeader()},opt.headers||{});
 const r=await fetch(API+path,{method:opt.method||'GET',headers:hdr,body:opt.body});
 const text=await r.text();
 if(r.status===401) throw new Error('Usuário ou senha inválidos');
 if(!r.ok) throw new Error((text||r.statusText||String(r.status)).slice(0,220));
 if(!text) return null;
 try{return JSON.parse(text);}catch(e){return text;}
}
async function reg(path,body){
 const r=await fetch(REG+path,{method:body?'POST':'GET',headers:{'Authorization':authHeader(),'X-Spartan-Auth':authHeader(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const text=await r.text();
 let data=null; try{data=JSON.parse(text);}catch(e){data=text;}
 if(!r.ok) throw new Error((data&&data.error)||text||r.statusText);
 return data;
}
function $(id){return document.getElementById(id);}
function permLabel(p){return ({op:'Admin',admin:'Admin',present:'Verificado',ouvinte:'Ouvinte',message:'Ouvinte',observe:'Ouvinte'})[p]||p;}
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
var PERM_OPTS=[{v:"op",l:"Admin"},{v:"present",l:"Verificado"},{v:"ouvinte",l:"Ouvinte"}];
function permLabelBtn(p){for(var i=0;i<PERM_OPTS.length;i++){if(PERM_OPTS[i].v===p)return PERM_OPTS[i].l;}return "Verificado";}
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
 const uk='u:'+SORT.users+':'+rows.map(r=>r.id+':'+r.name+':'+r.perm).join('|');
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
   const row=document.createElement('div'); row.className='user-row';
   row.innerHTML='<div class="who"><b></b></div><button type="button" class="ren">Renomear</button><div class="role-wrap"><button type="button" class="role-btn"></button><div class="role-menu"></div></div><button type="button" class="rst">Redefinir senha</button><button type="button" class="del">Excluir</button><button type="button" class="blk">Bloquear</button>';
   const title=(uid!=null?('ID '+uid+' · '):'')+name;
   row.querySelector('b').textContent=title;
   var sm=document.createElement('span'); sm.className='hint'; sm.textContent=fmtSeen(name,GROUP,item.rec); row.querySelector('.who').appendChild(sm);
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
    const inp=$('ui-dlg-input'); if(inp) inp.type='password';
    const np=await uiPrompt('Nova senha para '+name+':');
    if(np==null) return;
    if(!np){uiMsg('Digite a nova senha');return;}
    if(!await uiConfirm('Confirmar nova senha para '+name+'?')) return;
    try{await api('/.groups/'+GROUP+'/.users/'+encodeURIComponent(name)+'/.password',{method:'POST',headers:{'Content-Type':'text/plain'},body:np}); uiMsg('Senha de '+name+' atualizada');}
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
   target.appendChild(row);
  });
 }
 render(boxOps, ops, 'Nenhum admin além das contas do servidor.');
 render(box, rest, 'Nenhum usuário próprio.');
}

async function loadRooms(){
 const box=$('rooms');
 const names=await api('/.groups/')||[];
 await loadSite();
 let meta={};
 try{ (await (await fetch('/spartan-api/rooms')).json()).forEach(r=>meta[r.id]=r); }catch(e){}
 const main=SITE.main||'spartan', home=SITE.home||main;
 const key='r:'+main+':'+home+':'+names.join('|')+JSON.stringify(meta);
 if(key===loadRooms._k) return; loadRooms._k=key;
 box.innerHTML='';
 const rest=names.filter(n=>n!==main).sort((x,y)=>x.localeCompare(y,'pt',{sensitivity:'base'}));
 function paint(n, isMain){
  const info=meta[n]||{};
  const wrap=document.createElement('div');
  if(isMain) wrap.className='room-main';
  const row=document.createElement('div'); row.className='room-row room-row-wide';
  row.innerHTML='<b></b><span class="sala-tag"></span><a class="btn-open" target="_blank" rel="noopener">Abrir</a>'+(isMain?'':'<button type="button" class="del">Apagar</button>');
  row.querySelector('b').textContent=n+(n===home?' · home':'');
  let tag=isMain?('principal · '+(info.open?'Pública':'Convite')):(info.ttl?(info.open?'Pública · 24h':'Convite · 24h'):(info.open?'Pública':'Convite'));
  if(info.ttl && info.remaining_s!=null){
   const s=Math.max(0, info.remaining_s|0), h=Math.floor(s/3600), m=Math.floor((s%3600)/60);
   tag+=' · '+h+'h '+String(m).padStart(2,'0')+'min';
  }
  row.querySelector('.sala-tag').textContent=tag;
  row.querySelector('a').href='/group/'+encodeURIComponent(n)+'/';
  if(!isMain){
   row.querySelector('.del').onclick=async()=>{
    if(!await uiConfirm('Apagar a sala '+n+' por completo?')) return;
    try{await api('/.groups/'+encodeURIComponent(n),{method:'DELETE'}); loadRooms._k=null; await loadRooms();}catch(e){uiMsg(e.message);}
   };
  }
  wrap.appendChild(row);
  if(isMain){
   const ed=document.createElement('div'); ed.className='room-edit';
   ed.innerHTML='<label>Título na home</label><input class="mtitle" type="text"/><label>Endereço (URL)</label><input class="mslug" type="text"/><button type="button" class="okbtn msave">Salvar nome e endereço</button>'+(info.open?'':'<label>Nova senha de amigos</label><input class="mpw" type="password" autocomplete="new-password"/><button type="button" class="rst mpws">Redefinir senha de amigos</button>');
   ed.querySelector('.mtitle').value=info.title||n;
   ed.querySelector('.mslug').value=n;
   ed.querySelector('.msave').onclick=async()=>{
    const title=ed.querySelector('.mtitle').value.trim();
    const id=ed.querySelector('.mslug').value.trim().toLowerCase().replace(/[^a-z0-9-]/g,'');
    if(!id){uiMsg('URL inválida');return;}
    try{ SITE=await reg('/rename-main',{id:id,title:title||id}); loadRooms._k=null; uiMsg('Sala principal atualizada: /group/'+id+'/'); await loadSite(); await loadRooms(); }
    catch(e){uiMsg(e.message);}
   };
   const pwbtn=ed.querySelector('.mpws');
   if(pwbtn) pwbtn.onclick=async()=>{
    const v=ed.querySelector('.mpw').value; if(!v){uiMsg('Digite a nova senha de amigos');return;}
    try{
     try{await api('/.groups/'+encodeURIComponent(n)+'/.wildcard-user',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({permissions:'present'})});}catch(e){}
     await api('/.groups/'+encodeURIComponent(n)+'/.wildcard-user/.password',{method:'POST',headers:{'Content-Type':'text/plain'},body:v});
     ed.querySelector('.mpw').value=''; uiMsg('Senha de amigos (Verificado) atualizada');
    }catch(e){uiMsg(e.message);}
   };
   wrap.appendChild(ed);
   const bar=document.createElement('div'); bar.className='room-pw';
   bar.innerHTML=n===home?'<span class="home-on">Esta é a sala da home</span>':'<button type="button" class="okbtn sethome">Voltar esta para a home</button>';
   const hb=bar.querySelector('.sethome');
   if(hb) hb.onclick=async()=>{ try{ SITE=await reg('/site-home',{group:n}); loadRooms._k=null; uiMsg('Home voltou para a sala principal'); await loadRooms(); }catch(e){uiMsg(e.message);} };
   wrap.appendChild(bar);
  } else {
   const bar=document.createElement('div'); bar.className='room-pw';
   let extra=n===home?'<span class="home-on">Esta é a sala da home</span>':(info.ttl?'':'<button type="button" class="okbtn sethome">Usar na home</button>');
   if(!info.open) extra='<input type="password" placeholder="Nova senha de amigos" autocomplete="new-password"/><button type="button" class="rst">Redefinir senha da sala</button> '+extra;
   bar.innerHTML=extra;
   const rst=bar.querySelector('.rst');
   if(rst) rst.onclick=async()=>{
    const v=bar.querySelector('input').value; if(!v){uiMsg('Digite a nova senha de amigos');return;}
    try{
     try{await api('/.groups/'+encodeURIComponent(n)+'/.wildcard-user',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({permissions:'present'})});}catch(e){}
     await api('/.groups/'+encodeURIComponent(n)+'/.wildcard-user/.password',{method:'POST',headers:{'Content-Type':'text/plain'},body:v});
     bar.querySelector('input').value=''; uiMsg('Senha de amigos da sala '+n+' atualizada');
    }catch(e){uiMsg(e.message);}
   };
   const sh=bar.querySelector('.sethome');
   if(sh) sh.onclick=async()=>{ try{ SITE=await reg('/site-home',{group:n}); loadRooms._k=null; uiMsg('Home agora abre a sala '+n); await loadRooms(); }catch(e){uiMsg(e.message);} };
   wrap.appendChild(bar);
  }
  box.appendChild(wrap);
 }
 if(names.indexOf(main)>=0) paint(main, true);
 rest.forEach(n=>paint(n, false));
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
   const pw=await uiPrompt('Senha para '+name+' (mínimo 8):'); if(!pw||pw.length<8){uiMsg('Senha curta');return;}
   try{await reg('/quick',{group:GROUP,user:name,password:pw,permissions:'present'}); loadUsers._k=null; loadGuests._k=null; if(loadBlocked) loadBlocked._k=null; await loadUsers(); await loadGuests(); await loadBlocked();}catch(e){uiMsg(e.message);}
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
async function afterLogin(){
 await loadSite();
 await api('/.groups/'+GROUP+'/.users/');
 document.documentElement.classList.remove('admin-gate');
 $('login-box').hidden=true; $('panel').hidden=false;
 $('who').textContent='Logado: '+user;
 await loadUsers(); await loadRooms(); await loadGuests(); await loadBlocked(); await loadTemps(); await loadLogs();
}
$('btn-login').onclick=async()=>{
 user=($('u').value||'').trim().toLowerCase(); $('u').value=user; pass=$('p').value; $('login-err').textContent='';
 try{
  const r=await fetch(REG+'/panel-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:user,password:pass})});
  let data=null; try{data=await r.json();}catch(e){data={};}
  if(!r.ok) throw new Error((data&&data.error)||'Usuário ou senha inválidos');
  sessionStorage.setItem('spartanAdmin',JSON.stringify({user:user,pass:pass}));
  try{localStorage.removeItem('spartanAdminHandoff');}catch(e){}
  await afterLogin();
 }catch(e){$('login-err').textContent=e.message;}
};
$('p').addEventListener('keydown',e=>{if(e.key==='Enter')$('btn-login').click();});
$('btn-out').onclick=()=>{try{sessionStorage.removeItem('spartanAdmin');}catch(e){} location.href='/';};
$('btn-create').onclick=async()=>{
 const n=($('nu').value||'').trim().toLowerCase(), p=$('np').value, perm=$('nperm').value; $('nu').value=n; $('create-msg').textContent='';
 if(!n||!p){$('create-msg').textContent='Nome e senha obrigatórios';return;}
 try{
  await api('/.groups/'+GROUP+'/.users/'+encodeURIComponent(n),{method:'PUT',headers:{'Content-Type':'application/json','If-None-Match':'*'},body:JSON.stringify({permissions:permToApi(perm)})});
  await api('/.groups/'+GROUP+'/.users/'+encodeURIComponent(n)+'/.password',{method:'POST',headers:{'Content-Type':'text/plain'},body:p});
  $('nu').value=''; $('np').value=''; $('create-msg').textContent='Usuário '+n+' criado'; await loadUsers();
 }catch(e){$('create-msg').textContent=e.message;}
};
$('btn-wild').onclick=async()=>{
 const p=$('wp').value; $('wild-msg').textContent='';
 if(!p){$('wild-msg').textContent='Digite a senha';return;}
 try{
  try{await api('/.groups/'+GROUP+'/.wildcard-user',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({permissions:'present'})});}catch(e){}
  await api('/.groups/'+GROUP+'/.wildcard-user/.password',{method:'POST',headers:{'Content-Type':'text/plain'},body:p});
  $('wp').value=''; $('wild-msg').textContent='Senha dos amigos atualizada';
 }catch(e){$('wild-msg').textContent=e.message;}
};
$('rkind-open')&&($('rkind-open').onchange=$('rkind-invite').onchange=function(){
 const invite=$('rkind-invite')&&$('rkind-invite').checked;
 if($('rp')){ $('rp').disabled=!invite; if(!invite) $('rp').value=''; }
});
$('rhost')&&($('rhost').onchange=function(){
 if($('rhost-wrap')) $('rhost-wrap').hidden=!$('rhost').checked;
});
$('btn-room').onclick=async()=>{
 let slug=$('rn').value.trim().toLowerCase().replace(/[^a-z0-9-]/g,'');
 const title=$('rd').value.trim()||slug;
 const open=!($('rkind-invite')&&$('rkind-invite').checked);
 const wp=$('rp')?$('rp').value:'';
 const wantHost=$('rhost')&&$('rhost').checked;
 const hostNick=(($('rhost-nick')&&$('rhost-nick').value)||'').trim().toLowerCase();
 const hostPw=$('rhost-pw')?$('rhost-pw').value:'';
 $('room-msg').textContent='';
 if(!slug){$('room-msg').textContent='Digite o nome da sala';return;}
 if(!open && (!wp || wp.length<8)){$('room-msg').textContent='Senha de convite com no mínimo 8 caracteres';return;}
 if(wantHost && (!hostNick || hostPw.length<8)){$('room-msg').textContent='Anfitrião precisa de nick e senha (mínimo 8)';return;}
 try{
  const body={id:slug,title:title,open:open,host:!!wantHost};
  if(!open) body.friends_password=wp;
  if(wantHost){ body.host_nick=hostNick; body.host_password=hostPw; }
  await reg('/create-room', body);
  $('rn').value=''; $('rd').value=''; if($('rp')) $('rp').value='';
  if($('rhost')) $('rhost').checked=false; if($('rhost-wrap')) $('rhost-wrap').hidden=true;
  if($('rhost-nick')) $('rhost-nick').value=''; if($('rhost-pw')) $('rhost-pw').value='';
  $('room-msg').textContent=open?('Sala '+slug+' pública criada (24h'+(wantHost?', anfitrião '+hostNick:'')+')'):('Sala '+slug+' de convite criada (24h'+(wantHost?', anfitrião '+hostNick:'')+')');
  loadRooms._k=null; await loadRooms();
 }catch(e){$('room-msg').textContent=e.message;}
};
document.querySelectorAll('.tab').forEach(b=>{
 b.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===b));
  $('tab-users').hidden=b.dataset.tab!=='users';
  $('tab-guests').hidden=b.dataset.tab!=='guests';
  $('tab-blocked').hidden=b.dataset.tab!=='blocked';
  $('tab-temps').hidden=b.dataset.tab!=='temps';
  if($('tab-logs')) $('tab-logs').hidden=b.dataset.tab!=='logs';
  $('tab-rooms').hidden=b.dataset.tab!=='rooms';
  if(b.dataset.tab==='logs'){ loadLogs._k=null; loadLogs(); }
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
setInterval(function(){ try{ if($('panel') && !$('panel').hidden){ loadUsers().catch(function(){}); loadGuests().catch(function(){}); loadBlocked().catch(function(){}); loadTemps().catch(function(){}); if($('tab-logs') && !$('tab-logs').hidden) loadLogs().catch(function(){}); } }catch(e){} }, 8000);
['log-tipo','log-nick','log-ip'].forEach(function(id){
 var el=$(id); if(!el) return;
 el.addEventListener(id==='log-tipo'?'change':'input', function(){ loadLogs._k=null; paintLogs(); });
});
