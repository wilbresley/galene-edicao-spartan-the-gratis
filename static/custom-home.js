'use strict';
async function atualizarSpartan(){
 var badge=document.getElementById('candangos'), btn=document.getElementById('spartan-btn');
 var site={main:'spartan',home:'spartan'};
 try{site=await (await fetch('/spartan-api/site',{cache:'no-store'})).json();}catch(e){}
 var homeId=site.home||site.main||'spartan';
 try{
  var groups=await (await fetch('/public-groups.json')).json();
  var g=(groups||[]).find(function(x){return x.name===homeId;})||(groups||[]).find(function(x){return x.name===site.main;})||(groups||[])[0];
  var n=g&&typeof g.clientCount==='number'?g.clientCount:0;
  if(badge) badge.textContent='Candangos online '+n;
  if(btn){
   var gid=homeId;
   btn.href='#/group/'+encodeURIComponent(gid);
   btn.setAttribute('data-spartan-route','group:'+gid);
   btn.textContent='Entrar na sala '+(g&&(g.displayName||g.description||g.name)||homeId);
  }
 }catch(e){
  if(badge) badge.textContent='Candangos online —';
  if(btn){
   btn.href='#/group/'+encodeURIComponent(homeId);
   btn.setAttribute('data-spartan-route','group:'+homeId);
  }
 }
}
atualizarSpartan(); setInterval(atualizarSpartan,5000);
