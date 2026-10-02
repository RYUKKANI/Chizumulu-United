/* Browser persistence and synchronization. No queue is removed until a durable server result. */
const offlineSync={enabled:false,connected:false,busy:false,bundle:null,snapshot:null,working:null,db:null,persist:Promise.resolve(),timer:null,error:'',medical:[],medicalPinned:[],matchday:false};
const O=window.ClubOffline;
const legacyLoadCloud=loadCloud,legacySave=save,legacyFlush=flushCloud,legacyPoll=pollMember,legacyStatus=updateSaveStatus,legacyLogout=memberLogout;
const networkMemberSession=syncMemberSession;
const beforeOfflineClear=clearClubAccess;
clearClubAccess=function(){
 offlineSync.releaseLock?.();offlineSync.releaseLock=null;offlineSync.lockKey=null;offlineSync.photoBusy=false;
 const oldId=offlineSync.bundle?.member?.id,oldKey=clubConfig.supabaseUrl+':'+oldId,previousPersist=offlineSync.persist;
 clearTimeout(offlineSync.timer);offlineSync.persisting=0;offlineSync.enabled=false;offlineSync.connected=false;offlineSync.busy=false;offlineSync.mediaBusy=false;offlineSync.medical=[];offlineSync.medicalPinned=[];offlineSync.snapshot=null;offlineSync.working=null;offlineSync.bundle=null;offlineSync.matchday=false;offlineSync.persist=Promise.resolve();
 if(oldId){if(localStorage.getItem(lastAccountKey())===oldId)localStorage.removeItem(lastAccountKey());previousPersist.catch(()=>{}).then(async()=>{const b=await syncStore('get',undefined,oldKey);if(b){b.snapshot=null;b.medicalPinned=[];b.mediaCache=[];b.member=null;await syncStore('put',b,oldKey);}}).catch(()=>{});}
 return beforeOfflineClear();
};
function lastAccountKey(){return 'chizumulu-last-field-view:'+clubConfig.supabaseUrl;}
function freshOfflineCache(cached){const age=Date.now()-cached?.lastVerified;return cached?.snapshot&&cached.member?.status==='active'&&Number.isFinite(age)&&age>=0&&age<7*86400000;}
async function acquireDeviceLock(){if(!CLOUD_SITE)return;const key=syncKey();if(offlineSync.lockKey===key)return;if(!navigator.locks)throw Object.assign(new Error(cloudText('이 기능은 최신 브라우저에서 열어 주세요.','Open this feature in a current browser.')),{status:409});const generation=membership.generation;await new Promise((resolve,reject)=>{navigator.locks.request('chizumulu-outbox:'+key,{ifAvailable:true},async lock=>{if(!lock){reject(Object.assign(new Error(cloudText('같은 계정을 사용 중인 다른 창을 닫은 뒤 다시 열어 주세요.','Close the other window using this account, then reopen.')),{status:409}));return;}if(generation!==membership.generation){reject(Error('ACCOUNT_CHANGED'));return;}offlineSync.lockKey=key;await new Promise(release=>{offlineSync.releaseLock=release;resolve();});}).catch(reject);});}
async function openCachedFieldView(){
 const id=localStorage.getItem(lastAccountKey());if(!id)return false;
 const cached=await syncStore('get',undefined,clubConfig.supabaseUrl+':'+id).catch(()=>null);
 if(!freshOfflineCache(cached))return false;
 if(navigator.onLine){const {error,status}=await membership.client.from('club_members').select('id').eq('id',id).single().retry(false).abortSignal(AbortSignal.timeout(5000));if(!error||status&&status<500)return false;}
 // This opens the previously approved, minimal field-work cache. It never creates an Auth session.
 return restoreOfflineSession({user:{id,email:cached.member.email}},{status:503});
}
syncMemberSession=async function(session){if(!session&&await openCachedFieldView())return;await networkMemberSession(session);if(memberActive()&&cloud.ready&&!offlineSync.enabled&&!offlineSync.availableChecked)await loadCloud();};
function syncKey(){return clubConfig.supabaseUrl+':'+membership.user?.id;}
function syncDatabase(){if(offlineSync.db)return offlineSync.db;return offlineSync.db=new Promise((resolve,reject)=>{const r=indexedDB.open('chizumulu-offline-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('accounts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function syncStore(mode,value,key=syncKey()){const db=await syncDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction('accounts',mode==='get'?'readonly':'readwrite'),r=mode==='get'?tx.objectStore('accounts').get(key):mode==='put'?tx.objectStore('accounts').put(value,key):tx.objectStore('accounts').delete(key);tx.oncomplete=()=>resolve(r.result);tx.onabort=tx.onerror=()=>reject(tx.error);});}
function persistSync(){const key=syncKey(),generation=membership.generation,bundle=O.copy(offlineSync.bundle);if(bundle.snapshot){bundle.snapshot.state=O.project(bundle.snapshot.state);bundle.snapshot.fullState=false;}offlineSync.persisting=(offlineSync.persisting||0)+1;offlineSync.persist=offlineSync.persist.catch(()=>{}).then(()=>syncStore('put',bundle,key)).catch(cause=>{throw Object.assign(new Error('DEVICE_STORAGE_FAILED'),{code:'DEVICE_STORAGE_FAILED',cause});});offlineSync.persist.then(()=>{if(generation===membership.generation&&key===syncKey()){offlineSync.persisting--;updateSaveStatus();}},error=>{if(generation===membership.generation&&key===syncKey()){offlineSync.persisting--;offlineSync.error=cloudText('기기 저장에 실패했습니다. 백업을 내려받아 주세요.','Device storage failed. Download a backup.');updateSaveStatus();}});return offlineSync.persist;}
async function requireSyncSession(){const generation=membership.generation;const auth=await membership.client.auth.getSession();if(generation!==membership.generation)throw Error('ACCOUNT_CHANGED');if(auth.error||auth.data.session?.user.id!==membership.user?.id)throw Object.assign(new Error(cloudText('같은 계정으로 다시 로그인한 뒤 전송할 수 있습니다.','Sign into this account again before sending.')),{code:'REAUTH_REQUIRED'});return generation;}
async function syncRPC(name,args={}){const generation=await requireSyncSession();const {data,error}=await membership.client.rpc(name,args).abortSignal(AbortSignal.timeout(20000));if(generation!==membership.generation)throw Error('ACCOUNT_CHANGED');if(error)throw Object.assign(translateMemberError(error),{code:error.message||error.code});return data;}
function refreshWorking(){const snapshot=O.copy(offlineSync.snapshot);if(cloud.draft)snapshot.state=O.copy(cloud.draft.state);state=O.merge(O.optimistic(snapshot,offlineSync.bundle.queue));offlineSync.working=O.copy(state);}
async function restoreOfflineSession(session,error){
 if(!session?.user||error?.status===401||error?.status===403||navigator.onLine&&error?.status&&error.status<500)return false;
 membership.user=session.user;const cached=await syncStore('get').catch(()=>null);
 if(!freshOfflineCache(cached))return false;
 await acquireDeviceLock();
 membership.member={...cached.member,role:'member'};offlineSync.enabled=cached.snapshot.enabled;offlineSync.connected=false;offlineSync.bundle=cached;offlineSync.snapshot=cached.snapshot;offlineSync.medical=[];offlineSync.medicalPinned=cached.medicalPinned||[];
 cloud.ready=true;cloud.revision=cached.snapshot.revision;cloud.savedAt=cached.snapshot.savedAt;cloud.conflict=false;cloud.error='';cloud.draft=null;refreshWorking();render();updateSaveStatus();return true;
}
loadCloud=async function(discard=false){
 if(!membership.client||!memberActive())return legacyLoadCloud(discard);
 const generation=membership.generation;let snapshot;
 offlineSync.availableChecked=true;
 try{snapshot=await syncRPC('get_club_snapshot');}
 catch(e){if(e.code==='PGRST202'||e.code?.includes('Could not find the function'))return legacyLoadCloud(discard);if(e.code==='MAINTENANCE'&&memberAdmin()){cloud.ready=false;showMemberLanding(cloudText('자료 이전으로 입력이 잠겨 있습니다.','Writes are paused for migration.'));document.querySelector('#content').insertAdjacentHTML('beforeend',btn(cloudText('입력 잠금 해제','Release maintenance pause'),'offline-maintenance-off','refresh'));return;}if(await restoreOfflineSession({user:membership.user},e))return;throw e;}
 offlineSync.serviceAvailable=true;offlineSync.cutoverPending=!snapshot.enabled;
 if(!snapshot.enabled)return legacyLoadCloud(discard);
 snapshot.fullState=true;
 await acquireDeviceLock();
 let cached=await syncStore('get').catch(()=>null);if(generation!==membership.generation)return;
 if(offlineSync.bundle?.member?.id===membership.user.id)cached=offlineSync.bundle;
 const queue=cached?.queue||[];
 if(cached?.snapshot?.syncEpoch&&cached.snapshot.syncEpoch!==snapshot.syncEpoch)for(const e of queue){e.status='review';e.result={code:'SYNC_EPOCH_CHANGED'};}
 offlineSync.enabled=true;offlineSync.connected=true;offlineSync.snapshot=snapshot;offlineSync.medical=snapshot.medical||[];delete snapshot.medical;
 localStorage.setItem(lastAccountKey(),membership.user.id);
 const activeIds=new Set(snapshot.state.players.filter(p=>p.status==='Active').map(p=>p.id));
 offlineSync.medicalPinned=O.medicalForOffline((cached?.medicalPinned||[]).filter(m=>activeIds.has(m.playerId)).map(m=>offlineSync.medical.find(x=>x.playerId===m.playerId)).filter(Boolean));
 offlineSync.bundle={snapshot,queue,member:O.copy(membership.member),lastVerified:Date.now(),medicalPinned:offlineSync.medicalPinned,lastPulledAt:new Date().toISOString(),oldDraft:cached?.oldDraft||null,mediaQueue:cached?.mediaQueue||[],mediaCache:cached?.mediaCache||[],legacyDraftArchive:cached?.legacyDraftArchive||[]};
 let draft=await draftOperation('get').catch(()=>null);if(generation!==membership.generation)return;
 cloud.draft=null;cloud.conflict=false;
 if(discard){draft=null;await cacheDraft(null);}else if(draft?.state.meta.syncFormat===1){
  if(draft.baseRevision===snapshot.revision)cloud.draft=draft;
  else{const inspection=await syncRPC('inspect_legacy_draft',{p_draft:draft});if(inspection.status==='already_applied')await cacheDraft(null);else{cloud.draft=draft;cloud.conflict=true;}}
 }else if(draft&&!offlineSync.bundle.legacyDraftArchive.some(x=>x.mutationId===draft.mutationId))offlineSync.bundle.oldDraft=draft;
 if(generation!==membership.generation)return;
 cloud.error='';cloud.ready=true;cloud.revision=snapshot.revision;cloud.savedAt=snapshot.savedAt;
 refreshWorking();validData(state);await persistSync();render();syncNow().catch(()=>{});
};
save=function(){
 if(!offlineSync.enabled)return legacySave();
 if(!memberActive()||!cloud.ready)throw Error('로그인·승인 상태를 확인해 주세요.');
 const before=offlineSync.working,after=O.copy(state),actions=O.diff(O.operational(before),O.operational(after),offlineSync.snapshot.sessions,{schemaVersion:1,syncEpoch:offlineSync.snapshot.syncEpoch,ownerUserId:membership.user.id,clientAt:new Date().toISOString()});
 if(actions.some(a=>a.kind.startsWith('allowance.')||a.kind==='expense.void'&&before.operations.finance.transactions.find(t=>t.id===a.target.id)?.allowanceId)&&(!offlineSync.connected||!navigator.onLine))throw Error('수당 등록·수정·지급·취소는 연결 후 처리해 주세요.');
 const onlineOnly=actions.some(a=>a.kind.startsWith('allowance.')||a.kind==='expense.void'&&before.operations.finance.transactions.find(t=>t.id===a.target.id)?.allowanceId);
 if(onlineOnly&&(offlineSync.busy||offlineSync.mediaBusy||syncCounts().pending))throw Error('이전 전송을 먼저 확인한 뒤 수당을 처리해 주세요.');
 const oldLegacy=O.legacyComparable(before),newLegacy=O.legacyComparable(after);
 for(const a of actions.filter(a=>a.kind==='training.set')){const r=after.training.find(r=>r.id===a.target.id);if(r){const key=r.date+'|'+r.playerId;if(newLegacy.operations.attendancePlans[key]===undefined)delete oldLegacy.operations.attendancePlans[key];}}
 const legacyChanged=!O.equal(oldLegacy,newLegacy);
 if(legacyChanged&&(!offlineSync.connected||offlineSync.snapshot.fullState===false))throw Error('오프라인에서는 준비된 훈련 출석과 일반 지출만 기록할 수 있습니다. 연결 후 이 항목을 수정해 주세요.');
 const commit=()=>{offlineSync.bundle.queue=O.enqueue(offlineSync.bundle.queue,actions);offlineSync.working=after;
 if(legacyChanged){const full=O.legacy(after);full.meta.savedAt=new Date().toISOString();cloud.draft={state:full,baseRevision:cloud.revision,mutationId:crypto.randomUUID()};cacheDraft(cloud.draft);}
 persistSync();updateSaveStatus();clearTimeout(offlineSync.timer);offlineSync.timer=setTimeout(()=>syncNow().catch(()=>{}),300);};
 if(onlineOnly){const generation=membership.generation;return syncRPC('get_club_snapshot').then(async()=>{if(generation!==membership.generation)throw Error('ACCOUNT_CHANGED');commit();await persistSync();await syncNow();if(actions.some(a=>offlineSync.bundle.queue.some(e=>e.action.mutationId===a.mutationId)))throw Error('수당 처리 완료를 확인하지 못했습니다. 기기에 보관한 요청을 먼저 동기화·확인해 주세요.');});}
 commit();
};
function syncCounts(){const q=offlineSync.bundle?.queue||[];return {pending:q.filter(e=>e.status==='queued').length+(offlineSync.bundle?.mediaQueue?.length||0),conflicts:q.filter(e=>e.status==='conflict').length,review:q.filter(e=>e.status==='review').length+(offlineSync.bundle?.oldDraft?1:0)};}
updateSaveStatus=function(){
 legacyStatus();if(!offlineSync.enabled||!cloud.ready)return;const c=syncCounts(),label=document.querySelector('#save-status');
 if(label){label.textContent=offlineSync.error?offlineSync.error:offlineSync.persisting?cloudText('기기에 저장 중…','Saving on device…'):c.conflicts||c.review?cloudText(`기기에 저장됨 · 충돌 ${c.conflicts} · 확인 ${c.review}`,`On device · ${c.conflicts} conflicts · ${c.review} to review`):c.pending||cloud.draft?cloudText(`기기에 저장됨 · 미전송 ${c.pending+(cloud.draft?1:0)}`,`On device · ${c.pending+(cloud.draft?1:0)} pending`):offlineSync.connected?cloudText('구단 공유 완료','Shared with club'):cloudText('오프라인 · 기기에 저장됨','Offline · stored on device');label.dataset.cloudStatus=c.pending?'pending':c.conflicts||c.review||offlineSync.error?'error':'saved';}
 const bar=document.querySelector('#offline-status');if(bar){bar.dataset.state=offlineSync.connected?'online':'offline';bar.querySelector('[data-sync-summary]').textContent=(offlineSync.connected?cloudText('연결됨','Connected'):cloudText('오프라인','Offline'))+' · '+cloudText(`미전송 ${c.pending} / 충돌 ${c.conflicts} / 확인 ${c.review}`,`${c.pending} pending / ${c.conflicts} conflicts / ${c.review} review`);bar.querySelector('[data-sync-time]').textContent=offlineSync.bundle.lastPulledAt?cloudText('마지막 확인: ','Last checked: ')+new Date(offlineSync.bundle.lastPulledAt).toLocaleString(lang==='en'?'en-GB':'ko-KR',{timeZone:'Africa/Blantyre'})+' CAT':'';}
};
async function syncNow(){
 if(!offlineSync.enabled)return legacyFlush();if(offlineSync.busy||!cloud.ready||!memberActive())return;
 const generation=membership.generation;offlineSync.busy=true;offlineSync.error='';
 try{
  await persistSync();const queued=[];
  for(const entry of offlineSync.bundle.queue.filter(e=>e.status==='queued')){const bytes=new TextEncoder().encode(JSON.stringify([...queued.map(e=>e.action),entry.action])).length;if(bytes>245760){if(!queued.length){entry.status='review';entry.result={code:'ACTION_TOO_LARGE'};}break;}queued.push(entry);if(queued.length===50)break;}
  if(queued.length){for(const e of queued)e.attempted=true;await persistSync();const reply=await syncRPC('apply_club_actions',{p_actions:queued.map(e=>e.action)});
   if(reply.syncEpoch!==offlineSync.snapshot.syncEpoch)throw Error('SYNC_EPOCH_CHANGED');
   if(!Array.isArray(reply.results)||reply.results.length!==queued.length||new Set(reply.results.map(r=>r.mutationId)).size!==queued.length||reply.results.some(r=>!queued.some(e=>e.action.mutationId===r.mutationId)))throw Error('동기화 결과를 확인하지 못했습니다.');
   for(const result of reply.results){const entry=offlineSync.bundle.queue.find(e=>e.action.mutationId===result.mutationId);if(!entry)throw Error('잘못된 동기화 응답입니다.');
    if(result.status==='applied'||result.status==='duplicate'){offlineSync.bundle.queue=offlineSync.bundle.queue.filter(e=>e!==entry);if(result.record)offlineSync.snapshot=O.applyRows(offlineSync.snapshot,[{domain:result.domain,record:result.record}]);}
    else if(result.status==='conflict'){entry.status='conflict';entry.result=result;}
    else if(result.status==='rejected'){entry.status=result.code==='CLIENT_UPGRADE_REQUIRED'?'queued':'review';entry.result=result;if(result.code==='CLIENT_UPGRADE_REQUIRED')throw Error('앱 업데이트가 필요합니다. 대기 중인 기록은 보존했습니다.');}
    else throw Error('알 수 없는 동기화 응답입니다.');
   }offlineSync.bundle.snapshot=offlineSync.snapshot;await persistSync();
  }
  let more=true;
  while(more){const page=await syncRPC('pull_club_changes',{p_after_seq:offlineSync.snapshot.cursor,p_sync_epoch:offlineSync.snapshot.syncEpoch,p_page_size:100});if(page.syncEpoch!==offlineSync.snapshot.syncEpoch)throw Error('SYNC_EPOCH_CHANGED');
   if(!Array.isArray(page.changes)||!/^\d+$/.test(page.nextCursor)||typeof page.hasMore!=='boolean')throw Error('INVALID_SYNC_PAGE');
   let cursor=BigInt(offlineSync.snapshot.cursor);for(const c of page.changes){if(!/^\d+$/.test(c.seq)||BigInt(c.seq)<=cursor)throw Error('INVALID_SYNC_CURSOR');cursor=BigInt(c.seq);}
   if(BigInt(page.nextCursor)!==cursor||page.hasMore&&!page.changes.length)throw Error('INVALID_SYNC_CURSOR');
   const next=O.applyRows(offlineSync.snapshot,page.changes);next.cursor=page.nextCursor;offlineSync.snapshot=next;offlineSync.bundle.snapshot=next;await persistSync();more=page.hasMore;
  }
  // Re-fetch the complete online state before allowing profile/contract edits after a field-cache session.
  if(offlineSync.snapshot.fullState===false)await loadCloud();
  if(cloud.draft){const draft=O.copy(cloud.draft);await legacyFlush();if(!cloud.draft&&!cloud.conflict&&cloud.revision===draft.baseRevision+1){offlineSync.snapshot.state=draft.state;offlineSync.snapshot.revision=cloud.revision;offlineSync.snapshot.savedAt=cloud.savedAt;}}
  offlineSync.connected=true;offlineSync.bundle.lastPulledAt=new Date().toISOString();offlineSync.bundle.lastVerified=Date.now();offlineSync.error='';offlineSync.attempts=0;await persistSync();
  // Preserve an open form. Confirmed rows and local proposals are rendered together after closing it.
  if(!document.querySelector('#dialog[open]')){refreshWorking();render();}
 }catch(e){if(generation!==membership.generation)return;offlineSync.connected=false;
  if(e.code==='SYNC_EPOCH_CHANGED'||e.message==='SYNC_EPOCH_CHANGED'){for(const entry of offlineSync.bundle.queue){entry.status='review';entry.result={code:'SYNC_EPOCH_CHANGED'};}await persistSync();offlineSync.error=cloudText('백업 복원 후 기록을 확인해야 합니다. 대기 중인 입력은 보존했습니다.','Review pending edits after a restore. Your entries are preserved.');}
  else offlineSync.error=e.code==='DEVICE_STORAGE_FAILED'?cloudText('기기 저장에 실패했습니다. 백업을 내려받아 주세요.','Device storage failed. Download a backup.'):e.code==='REAUTH_REQUIRED'?e.message:e.code==='MAINTENANCE'?cloudText('기록 이전 중 · 입력은 기기에 보관됩니다.','Migration in progress · entries remain on device.'):cloudText('연결 대기 · 입력은 이 기기에 보관됩니다.','Waiting for connection · entries remain on this device.');
  offlineSync.attempts=(offlineSync.attempts||0)+1;
 }finally{if(generation===membership.generation){offlineSync.busy=false;updateSaveStatus();clearTimeout(offlineSync.timer);if(syncCounts().pending||cloud.draft){const delay=Math.min(300000,1000*3**Math.min(offlineSync.attempts||0,6));offlineSync.timer=setTimeout(()=>{if(document.visibilityState==='visible')syncNow().catch(()=>{});},delay*(.8+Math.random()*.4));}}}
}
flushCloud=function(){return offlineSync.enabled?syncNow():legacyFlush();};
pollMember=async function(){if(!offlineSync.enabled)return legacyPoll();if(document.visibilityState!=='visible'||!membership.user||membership.busy||offlineSync.busy)return;
 const {data,error}=await membership.client.from('club_members').select('id,email,display_name,role,status,created_at,updated_at').eq('id',membership.user.id).single();
 if(error)return;if(data.status!=='active'){await purgeOfflineView();offlineSync.enabled=false;membership.member=data;clearClubAccess();showMemberLanding();return;}
 membership.member=data;const revision=await requestRevision();if(revision!==cloud.revision&&!cloud.draft&&!document.querySelector('#dialog[open]'))await loadCloud();else await syncNow();
 const {data:head,error:headError}=await membership.client.from('sync_heads').select('medical_revision,sync_epoch').eq('club_id',1).single();
 if(!headError&&head.sync_epoch!==offlineSync.snapshot?.syncEpoch&&!document.querySelector('#dialog[open]'))await loadCloud();
 else if(!headError&&String(head.medical_revision)!==offlineSync.snapshot?.medicalRevision){const {data:medical,error:medicalError}=await membership.client.from('player_medical').select('player_id,data,version');if(!medicalError){offlineSync.medical=medical.map(m=>({playerId:m.player_id,data:m.data,version:String(m.version)}));offlineSync.medicalPinned=O.medicalForOffline(offlineSync.medicalPinned.map(m=>offlineSync.medical.find(x=>x.playerId===m.playerId)).filter(Boolean));offlineSync.bundle.medicalPinned=offlineSync.medicalPinned;offlineSync.snapshot.medicalRevision=String(head.medical_revision);await persistSync();}}
};
async function purgeOfflineView(){localStorage.removeItem(lastAccountKey());clearTimeout(offlineSync.timer);await offlineSync.persist.catch(()=>{});const bundle=await syncStore('get').catch(()=>null);if(bundle){bundle.snapshot=null;bundle.medicalPinned=[];bundle.mediaCache=[];bundle.member=null;await syncStore('put',bundle);}offlineSync.medical=[];offlineSync.medicalPinned=[];offlineSync.snapshot=null;offlineSync.working=null;offlineSync.bundle=null;offlineSync.connected=false;offlineSync.matchday=false;}
window.addEventListener('pagehide',()=>{offlineSync.releaseLock?.();offlineSync.releaseLock=null;offlineSync.lockKey=null;});
window.addEventListener('pageshow',e=>{if(e.persisted&&offlineSync.enabled)loadCloud().catch(err=>offlineToast(err.message,true));});
memberLogout=async function(force=false){if(!offlineSync.enabled)return legacyLogout(force);const c=syncCounts();if((c.pending||c.conflicts||c.review||cloud.draft)&&!force){modal(cloudText('기기에 남은 기록','Records on this device'),`<div class="dialogbody"><p>${cloudText('미전송·충돌 기록을 먼저 백업하거나 동기화할 수 있습니다. 보관 후 로그아웃하면 같은 계정으로 다시 로그인해야 전송할 수 있습니다.','Back up or sync pending/conflicting records first. Retained records can only be sent after signing into this account again.')}</p></div>`,`<div class="dialogfoot">${btn(cloudText('취소','Cancel'),'close-dialog','close')}${btn(cloudText('백업 다운로드','Download backup'),'offline-backup','download')}${btn(cloudText('동기화 시도','Try sync'),'offline-sync','refresh')}${btn(cloudText('보관 후 로그아웃','Keep and sign out'),'offline-logout-keep','close')}${btn(cloudText('영구 삭제 후 로그아웃','Discard and sign out'),'offline-logout-delete','close')}</div>`);return;}
 await purgeOfflineView();offlineSync.enabled=false;return legacyLogout(force);
};
window.addEventListener('online',()=>{if(offlineSync.enabled)syncNow().catch(()=>{});});
window.addEventListener('offline',()=>{offlineSync.connected=false;updateSaveStatus();});
document.addEventListener('visibilitychange',()=>{if(offlineSync.enabled&&document.visibilityState==='visible')syncNow().catch(()=>{});});
window.addEventListener('beforeunload',e=>{const c=syncCounts();if(c.pending||c.conflicts||c.review){e.preventDefault();e.returnValue='';}});
// Membership can finish while later feature scripts are loading on a fast/local connection.
setTimeout(()=>{if(CLOUD_SITE&&!navigator.onLine&&membership.client){openCachedFieldView().catch(()=>{});return;}if(CLOUD_SITE&&memberActive()&&cloud.ready&&!offlineSync.availableChecked)loadCloud().catch(()=>{});},0);
