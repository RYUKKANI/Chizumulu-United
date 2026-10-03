/* Daily workflow uses the existing save/queue and permissions. No second attendance store. */
(function(){
  'use strict';
  const W=window.ClubWorkspaceModel,M=window.ClubOperations,before=render,previousAttendance=operationsViews.attendance,fullProfile=profile,previousStatus=updateSaveStatus;
  // A cached older model remains usable until the user activates the complete new shell.
  if(typeof W?.dailyRecord!=='function'||typeof W?.markDailyAttendance!=='function')return;
  const desktop=matchMedia('(min-width:1100px)');
  let rosterPlayer='',attendanceDate=M.localDay(),attendanceSession='',expanded=false,rosterFilters=false;
  const words=(ko,en)=>lang==='en'?en:ko;
  const migrated=()=>typeof offlineSync!=='undefined'&&offlineSync.enabled;
  const canEdit=()=>!CLOUD_SITE||(memberActive()&&cloud.ready&&!cloud.conflict);
  const sessions=()=>migrated()?offlineSync.snapshot.sessions:[];
  const action=(label,name,extra='',kind='')=>`<button type="button" class="btn ${kind}" data-daily-action="${name}" ${extra}>${esc(label)}</button>`;
  Object.assign(EN,{'오늘 출석':'Today’s Attendance','주간 출석·본업':'Weekly Attendance & Day Jobs'});
  function dailyAttendance(){
    const choices=sessions().filter(s=>s.date===attendanceDate);
    if(!choices.some(s=>s.id===attendanceSession))attendanceSession=choices.length===1?choices[0].id:'';
    const players=state.players.filter(p=>p.status==='Active');
    const rows=players.map(p=>({p,...W.dailyRecord(state,p.id,attendanceDate,attendanceSession,sessions(),migrated())}));
    const recorded=rows.filter(x=>x.record?.attendance).length,future=attendanceDate>M.localDay();
    return head(words('오늘 출석','Today’s Attendance'),words('회차를 확인하고 출석 상태를 눌러 기록하세요.','Check the session and tap each player’s attendance status.'),'')+
      `<section class="panel daily-attendance"><div class="daily-controls"><label>${words('훈련일 (CAT)','Training date (CAT)')}<input id="daily-date" type="date" value="${esc(attendanceDate)}" max="${M.localDay()}" required></label>${action(words('오늘','Today'),'today')}${migrated()?`<label class="daily-session-label">${words('훈련 회차','Session')}<select id="daily-session"><option value="">${esc(words(choices.length?'회차 선택':'준비된 회차 없음',choices.length?'Select session':'No prepared session'))}</option>${choices.map(s=>`<option value="${esc(s.id)}" ${s.id===attendanceSession?'selected':''}>#${s.sessionNo} · ${esc(s.name||words('훈련','Training'))}</option>`).join('')}</select></label>${action(words('회차 추가','New session'),'new-session','title="'+esc(words('온라인에서 회차 만들기','Create a session while online'))+'"','daily-session-create')}`:''}</div>
      <div class="daily-progress" role="status"><strong>${words(`입력 ${recorded} / ${players.length}명`,`Recorded ${recorded} / ${players.length}`)}</strong><span>${words(`출석·지각 ${rows.filter(x=>['Present','Late'].includes(x.record?.attendance)).length}명 · 미입력 ${players.length-recorded}명`,`${rows.filter(x=>['Present','Late'].includes(x.record?.attendance)).length} present/late · ${players.length-recorded} unrecorded`)}</span></div>
      ${future?notice(words('미래 날짜에는 실제 출석을 기록할 수 없습니다. 주간 화면에서 참가 계획을 입력하세요.','Future attendance cannot be recorded. Use the weekly screen to plan availability.'),true):''}
      ${migrated()&&!attendanceSession?notice(words('이 날짜의 회차를 선택하거나 온라인에서 만들어 주세요. 원정 전에 회차를 준비하면 오프라인에서도 기록할 수 있습니다.','Select or create a session for this date. Sessions prepared before departure can be used offline.')):''}
      <div class="daily-player-list">${rows.map(({p,record,blocked})=>{
        const disabled=!!blocked||future,planned=M.attendance(state,p,attendanceDate);
        return `<div class="daily-player-row" data-daily-player="${esc(p.id)}"><div>${namecell(p)}<small class="daily-plan">${esc(words('예정: ','Plan: '))}${esc(record?words('실제 기록 있음','Actual record exists'):planned.value==='busy'?words('본업 불참','Unavailable for work'):Object.hasOwn(state.operations.attendancePlans,attendanceDate+'|'+p.id)||Object.hasOwn(state.operations.workSchedules,p.id)?words('참가 예정','Planned available'):words('미확인','Unconfirmed'))}</small></div><div class="daily-markers" role="group" aria-label="${esc(playerDisplayName(p))} ${esc(words('출석','attendance'))}">${[['Present','출석','Present'],['Late','지각','Late'],['Absent','결석','Absent']].map(([value,ko,en])=>action(words(ko,en),'mark',`data-player="${esc(p.id)}" data-status="${value}" aria-pressed="${record?.attendance===value}" ${disabled?'disabled':''}`,record?.attendance===value?'selected':'')).join('')}<select data-daily-other="${esc(p.id)}" aria-label="${esc(playerDisplayName(p))} ${esc(words('기타 출석 상태','Other attendance status'))}" ${disabled?'disabled':''}><option value="">${esc(record&&['Excused','Rehab'].includes(record.attendance)?t(record.attendance):words('기타','Other'))}</option><option value="Excused">${esc(t('Excused'))}</option><option value="Rehab">${esc(t('Rehab'))}</option></select></div><span class="daily-record-label">${esc(blocked==='multiple'?words('여러 기록 · 리뷰에서 수정','Multiple records · edit in review'):record?.attendance?t(record.attendance):words('미입력','Not recorded'))}</span></div>`;
      }).join('')||empty(words('현역 선수가 없습니다.','No active players.'),'')}</div></section>`;
  }
  operationsViews.attendance=function(){return subtab==='today'?dailyAttendance():previousAttendance();};
  function rosterPreview(){
    const panel=document.querySelector('.compact-roster');if(!panel||!desktop.matches)return;
    const available=[...panel.querySelectorAll('[data-action="profile"]')].map(b=>b.dataset.id);
    if(!available.includes(rosterPlayer))rosterPlayer=available[0]||'';
    const p=getPlayer(rosterPlayer);if(!p)return;
    const filters=panel.querySelector('.filters'),search=filters?.querySelector('.search'),sortControl=panel.querySelector('#player-sort');
    if(filters&&search){const searchbar=document.createElement('div');searchbar.className='daily-roster-search';searchbar.append(search);searchbar.insertAdjacentHTML('beforeend',action(words('필터·정렬','Filter & sort'),'roster-filters',`aria-expanded="${rosterFilters}" aria-controls="daily-roster-filters"`));filters.before(searchbar);filters.id='daily-roster-filters';filters.hidden=!rosterFilters;if(sortControl)filters.append(sortControl);}
    for(const row of panel.querySelectorAll('tbody tr')){const b=row.querySelector('[data-action="profile"]');if(b){row.dataset.dailyRoster=b.dataset.id;row.classList.toggle('roster-selected',b.dataset.id===rosterPlayer);b.setAttribute('aria-pressed',String(b.dataset.id===rosterPlayer));}}
    const layout=document.createElement('div');layout.className='daily-roster-layout';panel.before(layout);layout.append(panel);
    const detail=document.createElement('aside');detail.className='panel roster-preview';detail.setAttribute('aria-label',words('선수 요약','Player summary'));
    const logs=state.matchLogs.filter(r=>r.playerId===p.id&&M.day(state.fixtures.find(f=>f.id===r.fixtureId)?.date)).sort((a,b)=>state.fixtures.find(f=>f.id===b.fixtureId).date.localeCompare(state.fixtures.find(f=>f.id===a.fixtureId).date)).slice(0,5);
    const training=state.training.filter(r=>r.playerId===p.id&&r.date>=M.shiftDay(M.localDay(),-27)&&r.date<=M.localDay());
    const s=statsFor(p.id);
    detail.innerHTML=`<div class="roster-preview-id">${avatar(p)}<span>NO. ${esc(p.number||'—')} · ${esc(p.id)}</span></div><h2>${esc(lang==='en'?p.name:p.koreanName||p.name)}</h2><p>${esc(lang==='en'?p.koreanName||'':p.koreanName?p.name:'')}</p><div class="profile-statuses">${badge(p.position,'blue')}${badge(p.availability||'Unknown')}${badge(p.registration||'Unknown')}</div><dl><div><dt>${words('최근 5경기','Last 5 matches')}</dt><dd>${logs.length?logs.reduce((n,r)=>n+Number(r.minutes||0),0)+words('분',' min'):words('미입력','Not recorded')}</dd></div><div><dt>${words('최근 4주 훈련','Last 4 weeks')}</dt><dd>${training.length?training.filter(r=>['Present','Late'].includes(r.attendance)).length+' / '+training.length:words('미입력','Not recorded')}</dd></div><div><dt>${words('시즌 득점 / 도움','Season goals / assists')}</dt><dd>${s.goals} / ${s.assists}</dd></div></dl><h3>${words('최근 출전','Recent appearances')}</h3>${logs.length?`<ul>${logs.map(r=>{const f=state.fixtures.find(f=>f.id===r.fixtureId);return `<li><span>R${esc(f.round)} · ${esc(f.opponent)}</span><b>${Number(r.minutes||0)}${words('분',' min')}</b></li>`;}).join('')}</ul>`:`<p class="tiny">${words('경기별 기록이 아직 없습니다.','No individual match records yet.')}</p>`}<div class="roster-preview-actions">${action(words('전체 상세 보기','Full player details'),'full-profile',`data-player="${esc(p.id)}"`,'primary')}${btn(words('정보 수정','Edit player'),'edit-player','edit',`data-id="${esc(p.id)}"`)}</div>`;
    layout.append(detail);
  }
  profile=function(id){if(view==='players'&&desktop.matches){rosterPlayer=id;render();document.querySelector(`[data-daily-roster="${CSS.escape(id)}"] .playername`)?.focus({preventScroll:true});}else fullProfile(id);};
  render=function(){
    before();if(CLOUD_SITE&&(!memberActive()||!cloud.ready))return;
    document.body.dataset.dailyWorkspace='ready';
    const account=document.querySelector('#content>.account-bar');if(account&&!['members','clubSetup','data'].includes(view))account.remove();
    const status=document.querySelector('#offline-status');
    if(status&&desktop.matches){status.dataset.expanded=String(expanded);status.append(Object.assign(document.createElement('button'),{type:'button',className:'btn small',textContent:words(expanded?'접기':'동기화 상세',expanded?'Less':'Sync details')}));const toggle=status.lastElementChild;toggle.dataset.dailyAction='sync-details';toggle.setAttribute('aria-expanded',String(expanded));}
    rosterPreview();updateSaveStatus();
  };
  updateSaveStatus=function(){previousStatus();const status=document.querySelector('#offline-status');if(!status)return;const label=document.querySelector('#save-status'),summary=status.querySelector('[data-sync-summary]');if(label&&summary)summary.textContent=label.textContent;};
  async function mark(playerId,status){
    if(!canEdit())return cloudWarning();const previous=clone(state);
    try{W.markDailyAttendance(state,{playerId,date:attendanceDate,sessionId:attendanceSession,sessions:sessions(),migrated:migrated(),status,id:crypto.randomUUID(),today:M.localDay()});await save();render();document.querySelector(`[data-daily-player="${CSS.escape(playerId)}"] [data-status="${status}"]`)?.focus({preventScroll:true});}
    catch(error){state=previous;toast(error.message,true);render();}
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-daily-action]');if(!b||b.disabled)return;e.preventDefault();e.stopImmediatePropagation();
    if(b.dataset.dailyAction==='mark')mark(b.dataset.player,b.dataset.status);
    else if(b.dataset.dailyAction==='full-profile')fullProfile(b.dataset.player);
    else if(b.dataset.dailyAction==='today'){attendanceDate=M.localDay();attendanceSession='';render();}
    else if(b.dataset.dailyAction==='new-session'){if(canEdit())openSessionForm();else cloudWarning();}
    else if(b.dataset.dailyAction==='sync-details'){expanded=!expanded;render();}
    else if(b.dataset.dailyAction==='roster-filters'){rosterFilters=!rosterFilters;render();}
  },true);
  document.addEventListener('change',e=>{
    if(e.target.id==='daily-date'){if(M.day(e.target.value)){attendanceDate=e.target.value;attendanceSession='';}render();}
    else if(e.target.id==='daily-session'){attendanceSession=e.target.value;render();}
    else if(e.target.matches('[data-daily-other]')&&e.target.value)mark(e.target.dataset.dailyOther,e.target.value);
  });
  desktop.addEventListener('change',()=>{if(!document.querySelector('#dialog[open]'))render();});
  render();
})();
