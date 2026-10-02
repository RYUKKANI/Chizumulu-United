/* Compact mobile controls. No change to the shared data or save APIs. */
(function(){
'use strict';
// An older service worker may still serve the previous lineup editor until Apply Update.
// Keep that editor usable, including offline, until all new shell files are active.
if(typeof window.clubLineupDirty!=='function')return;
document.body.dataset.mobileWorkflow='ready';
const before=render,previousStatus=updateSaveStatus,smallScreen=matchMedia('(max-width:760px)');
let filtersOpen=false,syncExpanded=false;
const words=(ko,en)=>lang==='en'?en:ko;
playerTab='active';
function saveBar(){
 if(view!=='lineup'||!draftLineup)return;
 const pitch=document.querySelector('.tactics-pitch-title'),status=document.querySelector('.tactics-save-status'),undo=document.querySelector('[data-tactics="undo"]');
 if(!pitch||!status)return;
 const bar=document.createElement('div');bar.className='mobile-lineup-save no-print';
 bar.innerHTML=`<div><strong>${esc(pitch.querySelector('span').textContent)}</strong><small data-mobile-save-status>${esc(status.textContent)}</small></div><button type="button" class="btn light" data-tactics="undo" ${undo?.disabled?'disabled':''}>${esc(words('되돌리기','Undo'))}</button><button type="button" class="btn primary" data-tactics="save">${esc(words('저장','Save'))}</button>`;
 document.querySelector('#content').append(bar);
}
render=function(){
 before();document.body.dataset.workspaceView=view;
 document.querySelector('.mobile-account-menu')?.remove();
 const account=document.querySelector('#content .account-bar');
 if(account){const menu=document.createElement('section');menu.className='mobile-account-menu';menu.setAttribute('aria-label',words('계정 및 관리','Account and administration'));menu.innerHTML=account.innerHTML;document.querySelector('.sidefoot')?.append(menu);}
 if(smallScreen.matches){
  const status=document.querySelector('#offline-status');
  if(status){status.dataset.expanded=String(syncExpanded);const toggle=document.createElement('button');toggle.type='button';toggle.className='btn small offline-expand';toggle.dataset.mobileAction='sync-details';toggle.setAttribute('aria-expanded',String(syncExpanded));toggle.textContent=words(syncExpanded?'접기':'상세',syncExpanded?'Less':'Details');status.append(toggle);}
  const roster=document.querySelector('.compact-roster'),filters=roster?.querySelector('.filters');
  if(filters){const searchbar=document.createElement('div');searchbar.className='roster-searchbar';searchbar.append(filters.querySelector('.search'));searchbar.insertAdjacentHTML('beforeend',`<button type="button" class="btn light" data-mobile-action="roster-filters" aria-expanded="${filtersOpen}" aria-controls="roster-extra-filters">${esc(words('필터','Filters'))}</button>`);filters.before(searchbar);filters.id='roster-extra-filters';filters.classList.add('roster-extra-filters');filters.hidden=!filtersOpen;const sort=roster.querySelector('#player-sort');if(sort)filters.append(sort);searchbar.append(filters);}
  for(const row of roster?.querySelectorAll('tbody tr')||[]){const button=row.querySelector('[data-action="profile"]');if(button)row.dataset.rosterPlayer=button.dataset.id;}
  saveBar();
 }
};
updateSaveStatus=function(){previousStatus();const label=document.querySelector('[data-mobile-save-status]'),status=document.querySelector('.tactics-save-status');if(label&&status){label.textContent=status.textContent;label.classList.toggle('warning',status.classList.contains('warning'));}};
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-mobile-action]');
 if(button){event.preventDefault();event.stopImmediatePropagation();if(button.dataset.mobileAction==='roster-filters')filtersOpen=!filtersOpen;else syncExpanded=!syncExpanded;render();return;}
 const row=event.target.closest('[data-roster-player]');
 if(row&&!event.target.closest('button,a,input,select,textarea')){event.preventDefault();event.stopImmediatePropagation();profile(row.dataset.rosterPlayer);}
},true);
smallScreen.addEventListener('change',()=>{if(!document.querySelector('#dialog[open]'))render();});
document.addEventListener('input',e=>{if(e.target.id==='tactics-note')updateSaveStatus();});
render();
})();
