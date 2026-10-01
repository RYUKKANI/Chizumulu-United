/* Membership, authorization and shared saves. All permissions are enforced in PostgreSQL. */
const clubConfig = window.CLUB_CONFIG || {};
const membership = { client:null, user:null, member:null, mode:'login', busy:false, members:[], query:'', generation:0, sync:0, recovery:false };
cloud={ready:false,loading:false,revision:0,draft:null,inFlight:false,error:'',errorStatus:0,conflict:false,attempts:0,timer:null,cacheQueue:Promise.resolve(),cacheAvailable:true,database:null};
const originalClubRender=render;
function cloudText(ko,en){return lang==='en'?en:ko;}
function memberActive(){return membership.member?.status==='active';}
function memberAdmin(){return memberActive()&&membership.member.role==='admin';}
function roleLabel(role){return role==='admin'?cloudText('관리자','Administrator'):cloudText('일반 회원','Member');}
function statusLabel(status){return ({pending:cloudText('승인 대기','Pending approval'),active:cloudText('사용 중','Active'),disabled:cloudText('비활성','Disabled')})[status]||status;}
function clubError(message,status){return Object.assign(new Error(message),{status});}
function translateMemberError(error){
  const messages={
    ADMIN_REQUIRED:cloudText('회원 관리에는 관리자 권한이 필요합니다.','Administrator access is required.'),
    ACTIVE_MEMBER_REQUIRED:cloudText('관리자 승인을 받은 회원만 구단 기록에 접근할 수 있습니다.','Only approved members can access club records.'),
    LAST_ADMIN_REQUIRED:cloudText('마지막 관리자 계정은 비활성화하거나 일반 회원으로 변경할 수 없습니다.','The last active administrator cannot be disabled or demoted.'),
    SAVE_CONFLICT:cloudText('다른 회원이 기록을 먼저 저장했습니다. 내 변경 내용을 백업한 뒤 최신 기록을 불러와 주세요.','Another member saved first. Back up your edits, then load the latest records.'),
    MEMBER_NOT_FOUND:cloudText('해당 회원을 찾을 수 없습니다. 목록을 새로고침해 주세요.','Member not found. Refresh the list.'),
    INVALID_CLUB_STATE:cloudText('저장할 기록의 형식을 확인해 주세요.','Check the format of the club records.'),
    CLUB_STATE_TOO_LARGE:cloudText('사진과 기록의 용량이 너무 큽니다. 백업을 보관한 뒤 사진 용량을 줄여 주세요.','The records and photos are too large. Back up the data and reduce photo sizes.'),
    'Invalid login credentials':cloudText('이메일 또는 비밀번호를 확인해 주세요.','Check your email and password.'),
    'Email not confirmed':cloudText('이메일의 가입 확인 링크를 먼저 눌러 주세요.','Confirm your email before signing in.'),
    'User already registered':cloudText('이미 가입한 이메일입니다. 로그인해 주세요.','This email is already registered. Please sign in.')
  };
  const message=messages[error.message]||cloudText('요청을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.','Could not complete the request. Check your connection and retry.');
  const status=error.code==='40001'||error.message==='SAVE_CONFLICT'?409:error.code==='42501'?403:error.status||0;
  return clubError(message,status);
}
function authMessage(message,error=false){const el=document.querySelector('#auth-message');if(el){el.textContent=message;el.dataset.error=String(error);}}
function clearClubAccess(){
  membership.generation++;clearTimeout(cloud.timer);cloud.ready=false;cloud.loading=false;cloud.draft=null;cloud.inFlight=false;cloud.conflict=false;cloud.error='';cloud.errorStatus=0;cloud.revision=0;
  state=clone(SEED);pendingRestore=null;undoState=null;draftLineup=null;logsBatch=null;fixturesBatch=null;storageOK=true;view='players';
  closeDialog();document.querySelector('#cloud-loader').hidden=true;document.querySelector('#cloud-banner').hidden=true;
  document.body.classList.add('membership-locked');
  document.querySelector('#nav').innerHTML='';document.querySelector('.topnav').classList.add('auth-hidden');document.body.classList.remove('menu-open');
}
function accountBar(){return `<div class="account-bar"><span class="account-name">${esc(membership.member.display_name)} <span class="badge ${memberAdmin()?'blue':'green'}">${roleLabel(membership.member.role)}</span></span><button class="btn small" data-action="member-account">${cloudText('내 계정','My account')}</button>${memberAdmin()?`<button class="btn small" data-action="member-list">${cloudText('회원 관리','Members')}</button>`:''}<button class="btn small light" data-action="member-logout">${cloudText('로그아웃','Sign out')}</button></div>`;}
render=function(){
  if(!CLOUD_SITE)return originalClubRender();
  if(!memberActive()||!cloud.ready){showMemberLanding();return;}
  document.body.classList.remove('membership-locked');
  document.querySelector('.topnav').classList.remove('auth-hidden');
  if(view==='members'){
    if(!memberAdmin()){view='players';return render();}
    document.querySelector('#content').innerHTML=accountBar()+renderMembers();
  }else{originalClubRender();document.querySelector('#content').insertAdjacentHTML('afterbegin',accountBar());}
  const nav=document.querySelector('#nav');
  nav.innerHTML=navItems.map(([group,id,label,ic])=>`${group?`<div class="navgroup">${group}</div>`:''}<button class="navbtn ${view===id?'active':''}" data-action="nav" data-view="${id}" ${view===id?'aria-current="page"':''}>${icon(ic)}${label}${id==='players'?`<span class="navcount">${state.players.filter(p=>p.status==='Active').length}</span>`:''}</button>`).join('');
  if(memberAdmin())nav.insertAdjacentHTML('beforeend',`<div class="navgroup">MEMBERS</div><button class="navbtn ${view==='members'?'active':''}" ${view==='members'?'aria-current="page"':''} data-action="member-list">${icon('users')}${cloudText('회원 관리','Members')}</button>`);
  if(view==='members')document.querySelectorAll('.topnav button').forEach(b=>b.classList.remove('active'));
  translateUI(nav);
  updateSaveStatus();
};
function showMemberLanding(notice=''){
  document.querySelector('#nav').innerHTML='';document.querySelector('.topnav').classList.add('auth-hidden');
  const content=document.querySelector('#content');
  if(!membership.client){
    content.innerHTML=`<section class="panel auth-card"><div class="eyebrow">CHIZUMULU UNITED FC</div><h1>${cloudText('회원 서비스 준비 중','Membership service is being prepared')}</h1><p>${cloudText('회원가입과 로그인 기능을 준비하고 있습니다. 관리자가 연결을 완료하면 사용할 수 있습니다.','Sign-up and sign-in will be available once the administrator completes setup.')}</p><p class="auth-message" role="status">${esc(notice)}</p></section>`;updateSaveStatus();return;
  }
  if(membership.user&&!membership.recovery){
    const disabled=membership.member?.status==='disabled',known=!!membership.member,active=memberActive();
    content.innerHTML=`<section class="panel auth-card"><div class="eyebrow">CHIZUMULU UNITED FC</div><h1>${!known?cloudText('회원 정보를 확인하는 중','Checking membership'):disabled?cloudText('비활성화된 계정입니다','Account disabled'):active?cloudText('구단 기록 불러오기','Load club records'):cloudText('관리자 승인 대기','Waiting for approval')}</h1><p>${esc(membership.member?.display_name||membership.user.email||'')}</p><p>${disabled?cloudText('이 계정의 구단 기록 접근이 중지되었습니다. 관리자에게 문의해 주세요.','Access to club records has been disabled. Contact an administrator.'):active?cloudText('공용 저장 공간에서 구단 기록을 불러옵니다.','Load club records from shared storage.'):known?cloudText('가입이 완료되었습니다. 관리자가 승인하면 구단 기록을 함께 관리할 수 있습니다.','Your account is registered. An administrator must approve access to club records.'):cloudText('회원 정보를 불러오지 못했다면 다시 확인해 주세요.','Retry if your membership could not be loaded.')}</p><div class="auth-message" id="auth-message" role="status">${esc(notice)}</div><div class="auth-secondary"><button class="btn primary" data-action="member-check">${active?cloudText('다시 불러오기','Retry loading'):cloudText('승인 상태 확인','Check approval')}</button><button class="btn" data-action="member-logout">${cloudText('로그아웃','Sign out')}</button></div></section>`;updateSaveStatus();return;
  }
  const signup=membership.mode==='signup',reset=membership.mode==='reset',recovery=membership.recovery;
  content.innerHTML=`<section class="panel auth-card"><div class="eyebrow">CHIZUMULU UNITED FC</div><h1>${recovery?cloudText('새 비밀번호 설정','Set a new password'):reset?cloudText('비밀번호 찾기','Reset password'):cloudText('구단 회원 로그인','Club member sign-in')}</h1><p>${cloudText('회원가입 후 관리자 승인을 받아 구단 기록을 함께 관리하세요.','Register and get administrator approval to manage club records together.')}</p>${!recovery&&!reset?`<div class="auth-tabs"><button class="btn ${signup?'':'primary'}" data-action="member-login-tab">${cloudText('로그인','Sign in')}</button><button class="btn ${signup?'primary':''}" data-action="member-signup-tab">${cloudText('회원가입','Sign up')}</button></div>`:''}<form id="member-auth-form">${signup&&!recovery&&!reset?`<label for="member-name">${cloudText('이름','Name')}</label><input id="member-name" name="name" autocomplete="name" maxlength="80" required>`:''}${!recovery?`<label for="member-email">${cloudText('이메일','Email')}</label><input id="member-email" name="email" type="email" autocomplete="email" maxlength="254" required>`:''}${!reset?`<label for="member-password">${cloudText('비밀번호','Password')}</label><input id="member-password" name="password" type="password" autocomplete="${signup||recovery?'new-password':'current-password'}" ${signup||recovery?'minlength="10"':''} maxlength="128" required>${signup||recovery?`<label for="member-password-confirm">${cloudText('비밀번호 확인','Confirm password')}</label><input id="member-password-confirm" name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" required><p class="smallnote">${cloudText('비밀번호는 10자 이상으로 입력해 주세요.','Use a password with at least 10 characters.')}</p>`:''}`:''}<button class="btn primary" type="submit">${recovery?cloudText('비밀번호 변경','Update password'):reset?cloudText('재설정 메일 보내기','Send reset email'):signup?cloudText('가입 신청','Register'):cloudText('로그인','Sign in')}</button></form><div id="auth-message" class="auth-message" role="status" aria-live="polite">${esc(notice)}</div>${clubConfig.emailRecoveryEnabled&&!recovery?`<div class="auth-secondary"><button class="btn small light" data-action="${reset?'member-login-tab':'member-reset-tab'}">${reset?cloudText('로그인으로 돌아가기','Back to sign-in'):cloudText('비밀번호를 잊으셨나요?','Forgot your password?')}</button></div>`:''}</section>`;
  updateSaveStatus();
}
async function syncMemberSession(session){
  const sync=++membership.sync;
  const switched=membership.user?.id!==session?.user?.id;
  if(switched){clearClubAccess();membership.member=null;membership.members=[];membership.query='';}
  membership.user=session?.user||null;
  if(!session){membership.member=null;membership.recovery=false;showMemberLanding();return;}
  try{
    const {data,error}=await membership.client.from('club_members').select('id,email,display_name,role,status,created_at,updated_at').eq('id',session.user.id).single();
    if(sync!==membership.sync)return;
    if(error)throw translateMemberError(error);
    membership.member=data;
    if(data.status!=='active'){clearClubAccess();showMemberLanding();return;}
    if(membership.recovery){showMemberLanding();return;}
    if(!cloud.ready)await loadCloud();else render();
  }catch(error){if(sync!==membership.sync)return;clearClubAccess();membership.member=null;showMemberLanding(error.message||cloudText('회원 정보를 확인하지 못했습니다.','Could not check membership.'));}
}
async function checkMember(){const {data,error}=await membership.client.auth.getSession();if(error)throw translateMemberError(error);await syncMemberSession(data.session);}
async function submitMemberAuth(form){
  if(membership.busy)return;membership.busy=true;
  const submit=form.querySelector('[type=submit]');submit.disabled=true;authMessage(cloudText('처리 중…','Please wait…'));
  const data=new FormData(form),email=String(data.get('email')||'').trim(),password=String(data.get('password')||'');
  try{
    if((membership.mode==='signup'||membership.recovery)&&password!==data.get('confirm'))throw clubError(cloudText('비밀번호 확인이 일치하지 않습니다.','Passwords do not match.'));
    if(membership.recovery){
      const result=await membership.client.auth.updateUser({password});if(result.error)throw translateMemberError(result.error);
      membership.recovery=false;await checkMember();offlineToast(cloudText('비밀번호를 변경했습니다.','Password updated.'));return;
    }
    if(membership.mode==='reset'){
      const result=await membership.client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(result.error)throw translateMemberError(result.error);
      authMessage(cloudText('가입된 이메일이면 비밀번호 재설정 안내를 보냈습니다.','If the account exists, a password reset email has been sent.'));return;
    }
    if(membership.mode==='signup'){
      const name=String(data.get('name')||'').trim();if(!name)throw clubError(cloudText('이름을 입력해 주세요.','Enter your name.'));
      const result=await membership.client.auth.signUp({email,password,options:{data:{display_name:name},emailRedirectTo:location.origin+location.pathname}});
      if(result.error)throw translateMemberError(result.error);
      if(result.data.session)await syncMemberSession(result.data.session);
      else {membership.mode='login';showMemberLanding(cloudText('가입 신청을 접수했습니다. 이메일 확인 안내가 도착하면 링크를 누른 뒤 로그인해 주세요. 가입 후에는 관리자 승인이 필요합니다.','Registration submitted. Confirm your email if requested, then sign in. Administrator approval is also required.'));}
      return;
    }
    const result=await membership.client.auth.signInWithPassword({email,password});if(result.error)throw translateMemberError(result.error);await syncMemberSession(result.data.session);
  }catch(error){authMessage(error.message||cloudText('처리하지 못했습니다. 다시 시도해 주세요.','Please retry.'),true);}
  finally{membership.busy=false;if(submit.isConnected)submit.disabled=false;const field=form.querySelector('[name=password]');if(field)field.value='';const confirm=form.querySelector('[name=confirm]');if(confirm)confirm.value='';}
}
async function requestClub(method='GET',payload){
  if(!memberActive())throw clubError(cloudText('관리자 승인이 필요합니다.','Administrator approval is required.'),403);
  if(method==='GET'){
    const {data,error}=await membership.client.from('club_state').select('state,revision,saved_at,last_mutation_id').eq('id',1).single();if(error)throw translateMemberError(error);
    validData(data.state);return {state:data.state,revision:Number(data.revision),savedAt:data.saved_at,lastMutationId:data.last_mutation_id};
  }
  validData(payload.state);
  const {data,error}=await membership.client.rpc('save_club_state',{p_state:payload.state,p_base_revision:payload.baseRevision,p_mutation_id:payload.mutationId});if(error)throw translateMemberError(error);
  if(!data||!Number.isSafeInteger(Number(data.revision))||data.mutationId!==payload.mutationId)throw clubError(cloudText('저장 완료를 확인하지 못했습니다. 다시 시도해 주세요.','Could not confirm the save. Retry.'),502);
  return {...data,revision:Number(data.revision)};
}
function draftDatabase(){
  if(cloud.database)return cloud.database;
  cloud.database=new Promise((resolve,reject)=>{const r=indexedDB.open('chizumulu-member-recovery-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return cloud.database;
}
function draftKey(){return clubConfig.supabaseUrl+':'+membership.user?.id;}
async function draftOperation(action,value,key=draftKey()){
  const database=await draftDatabase();return new Promise((resolve,reject)=>{const tx=database.transaction('drafts',action==='get'?'readonly':'readwrite'),store=tx.objectStore('drafts');const r=action==='get'?store.get(key):action==='put'?store.put(value,key):store.delete(key);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
function cacheDraft(draft){const snapshot=draft?clone(draft):null,key=draftKey();cloud.cacheQueue=cloud.cacheQueue.then(()=>draftOperation(snapshot?'put':'delete',snapshot,key)).catch(()=>{cloud.cacheAvailable=false;});return cloud.cacheQueue;}
function save(){
  if(!CLOUD_SITE)return offlineSave();
  if(!memberActive()||!cloud.ready||cloud.conflict)return cloudWarning();
  state.meta.savedAt=new Date().toISOString();cloud.draft={state:clone(state),baseRevision:cloud.revision,mutationId:crypto.randomUUID()};cloud.attempts=0;cloud.error='';storageOK=false;
  cacheDraft(cloud.draft);updateSaveStatus();clearTimeout(cloud.timer);cloud.timer=setTimeout(flushCloud,250);
}
function toast(message,error=false){if(CLOUD_SITE&&cloud.draft&&!error){cloud.successMessage=message;return;}offlineToast(message,error);}
function cloudWarning(){offlineToast(cloudText('로그인·승인 상태와 최신 기록을 확인한 뒤 다시 수정해 주세요.','Check your membership and load the latest records before editing.'),true);}
function updateSaveStatus(){
  if(!CLOUD_SITE)return offlineUpdateSaveStatus();
  const caption=document.querySelector('.sidefoot .small');if(caption)caption.textContent=cloudText('구단 공용 저장 공간','Shared club storage');
  const label=document.querySelector('#save-status');if(label){label.textContent=!membership.client?cloudText('회원 서비스 준비 중','Membership setup pending'):!membership.user?cloudText('로그인 필요','Sign-in required'):!memberActive()?statusLabel(membership.member?.status||'pending'):cloud.conflict?cloudText('다른 회원의 변경 확인 필요','Review other members’ changes'):cloud.error?cloudText('저장 확인 필요','Save needs attention'):cloud.draft?cloudText('저장 중…','Saving…'):cloud.ready?cloudText('사이트에 저장됨','Saved to club storage'):cloudText('구단 기록 불러오는 중…','Loading club records…');label.dataset.cloudStatus=cloud.conflict||cloud.error?'error':cloud.draft?'pending':'saved';}
  const banner=document.querySelector('#cloud-banner'),text=cloud.conflict?cloudText('다른 회원이 같은 기록을 수정했습니다. 내 변경 내용은 이 기기에 보관되어 있습니다. 백업한 뒤 최신 기록을 불러와 주세요.','Another member changed the records. Your edits are preserved on this device. Back up your edits, then load the latest records.'):cloud.error;
  banner.hidden=!text||!cloud.ready;
  if(!banner.hidden)banner.innerHTML=`<span>${esc(text)}</span><div>${btn(cloudText('내 변경 내용 백업','Back up my changes'),'backup','download')}${btn(cloudText('최신 기록 불러오기','Load latest records'),'cloud-reload','refresh')}${!cloud.conflict?btn(cloudText('다시 저장','Retry save'),'cloud-retry','save'):''}</div>`;
}
function renderData(){
  let html=offlineRenderData();if(!CLOUD_SITE)return html;
  html=html.replace('변경 내용은 현재 브라우저에 자동 저장됩니다. 다른 기기와 자동 동기화되지 않으며 원본 엑셀도 변경되지 않습니다. 브라우저 데이터를 지우기 전에 백업을 내려받아 주세요.',cloudText('구단 기록은 공용 저장 공간에 자동 저장됩니다. 승인된 회원은 다른 기기에서도 같은 기록을 관리할 수 있습니다. 중요한 작업 후에는 JSON 백업도 보관해 주세요.','Records are saved to shared club storage. Approved members can access the same records on other devices. Keep JSON backups after important work.'));
  // A downloaded standalone HTML cannot include the shared membership service.
  return html.replace(/<section class="action-card">(?:(?!<\/section>)[\s\S])*?data-action="snapshot"(?:(?!<\/section>)[\s\S])*?<\/section>/g,'');
}
async function loadCloud(discard=false){
  if(cloud.loading||!memberActive())return;
  const generation=membership.generation;cloud.loading=true;const loader=document.querySelector('#cloud-loader');loader.hidden=false;loader.textContent=cloudText('구단 기록을 불러오는 중…','Loading club records…');
  try{
    const server=await requestClub();if(generation!==membership.generation)return;
    let pending=null;if(discard){await cacheDraft(null);cloud.draft=null;}else try{pending=await draftOperation('get');}catch{cloud.cacheAvailable=false;}
    if(generation!==membership.generation)return;
    cloud.revision=server.revision;cloud.savedAt=server.savedAt;cloud.error='';cloud.errorStatus=0;cloud.conflict=false;
    if(pending){validData(pending.state);if(pending.mutationId===server.lastMutationId){await cacheDraft(null);if(generation!==membership.generation)return;state=server.state;cloud.draft=null;}else{state=pending.state;cloud.draft=pending;cloud.conflict=pending.baseRevision!==server.revision;}}else state=server.state;
    loadError='';cloud.ready=true;storageOK=!cloud.draft;render();if(cloud.draft&&!cloud.conflict)flushCloud();
  }catch(error){if(generation!==membership.generation)return;cloud.error=error.message;cloud.errorStatus=error.status||0;if(!cloud.ready)showMemberLanding(cloud.error);updateSaveStatus();}
  finally{if(generation===membership.generation){cloud.loading=false;loader.hidden=true;}}
}
async function flushCloud(){
  if(!memberActive()||!cloud.ready||cloud.inFlight||cloud.conflict||!cloud.draft)return;
  const generation=membership.generation,sending=clone(cloud.draft);cloud.inFlight=true;cloud.error='';updateSaveStatus();
  try{
    await cloud.cacheQueue;if(generation!==membership.generation)return;
    const result=await requestClub('PUT',sending);if(generation!==membership.generation)return;
    cloud.revision=result.revision;cloud.savedAt=result.savedAt;cloud.attempts=0;
    if(cloud.draft?.mutationId===sending.mutationId){cloud.draft=null;state.meta.savedAt=result.savedAt;storageOK=true;await cacheDraft(null);offlineToast(cloudText('사이트에 저장했습니다.','Saved to club storage.'));}
    else if(cloud.draft){cloud.draft.baseRevision=result.revision;await cacheDraft(cloud.draft);}
  }catch(error){
    if(generation!==membership.generation)return;storageOK=false;cloud.error=error.message;cloud.errorStatus=error.status||0;
    if(error.status===409)cloud.conflict=true;else if(!error.status||error.status>=500){cloud.attempts++;if(cloud.attempts<=3)cloud.timer=setTimeout(flushCloud,[1000,3000,8000][cloud.attempts-1]);}
    offlineToast(cloud.error,true);if(error.status===401||error.status===403)checkMember().catch(()=>{});
  }finally{if(generation===membership.generation){cloud.inFlight=false;updateSaveStatus();if(cloud.draft&&!cloud.conflict&&!cloud.error){clearTimeout(cloud.timer);cloud.timer=setTimeout(flushCloud,100);}}}
}
function renderMembers(){
  const filtered=membership.members.filter(m=>(m.display_name+' '+m.email).toLowerCase().includes(membership.query.toLowerCase()));
  return `<section class="panel member-card"><h1>${cloudText('회원 관리','Member management')}</h1><p class="smallnote">${cloudText('가입 신청을 승인하고 회원의 권한과 이용 상태를 관리합니다.','Approve registrations and manage member roles and access.')}</p><div class="member-stats">${['pending','active','disabled'].map(s=>`<span>${statusLabel(s)} <b>${membership.members.filter(m=>m.status===s).length}</b></span>`).join('')}</div><div class="member-filter"><input id="member-search" type="search" value="${esc(membership.query)}" placeholder="${cloudText('이름 또는 이메일 검색','Search name or email')}" aria-label="${cloudText('회원 검색','Search members')}"><button class="btn small" data-action="member-refresh">${cloudText('새로고침','Refresh')}</button></div><div class="table-scroll"><table><thead><tr>${[cloudText('회원','Member'),cloudText('권한','Role'),cloudText('상태','Status'),cloudText('가입일','Joined'),cloudText('관리','Manage')].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${filtered.map(m=>`<tr><td><b>${esc(m.display_name)}</b>${m.id===membership.user.id?` <span class="member-self">${cloudText('(나)','(you)')}</span>`:''}<div class="subtext">${esc(m.email)}</div></td><td>${roleLabel(m.role)}</td><td><span class="badge ${m.status==='active'?'green':m.status==='pending'?'amber':'red'}">${statusLabel(m.status)}</span></td><td>${esc(new Date(m.created_at).toLocaleDateString(lang==='en'?'en-GB':'ko-KR',{timeZone:'Asia/Seoul'}))}</td><td><div class="member-tools">${m.status!=='active'?`<button class="btn small primary" data-action="member-change" data-id="${esc(m.id)}" data-role="${m.role}" data-status="active">${m.status==='pending'?cloudText('가입 승인','Approve'):cloudText('이용 재개','Reactivate')}</button>`:''}${m.status!=='disabled'?`<button class="btn small" data-action="member-change" data-id="${esc(m.id)}" data-role="${m.role}" data-status="disabled">${cloudText('비활성화','Disable')}</button>`:''}<button class="btn small light" data-action="member-change" data-id="${esc(m.id)}" data-role="${m.role==='admin'?'member':'admin'}" data-status="${m.status}">${m.role==='admin'?cloudText('일반 회원으로','Make member'):cloudText('관리자로','Make admin')}</button></div></td></tr>`).join('')||`<tr><td colspan="5" class="members-empty">${cloudText('표시할 회원이 없습니다.','No members to display.')}</td></tr>`}</tbody></table></div></section>`;
}
async function loadMembers(){
  if(!memberAdmin())throw clubError(cloudText('관리자 권한이 필요합니다.','Administrator access is required.'),403);
  const generation=membership.generation;const {data,error}=await membership.client.from('club_members').select('id,email,display_name,role,status,created_at,updated_at').order('created_at',{ascending:false});if(error)throw translateMemberError(error);
  if(generation!==membership.generation||!memberAdmin())return;membership.members=data;view='members';render();
}
function memberChangeDialog(button){
  if(!memberAdmin())return cloudWarning();const m=membership.members.find(m=>m.id===button.dataset.id);if(!m)return;
  modal(cloudText('회원 설정 변경','Change member settings'),`<div class="dialogbody"><p><b>${esc(m.display_name)}</b><br>${esc(m.email)}</p><p>${roleLabel(m.role)} → ${roleLabel(button.dataset.role)}<br>${statusLabel(m.status)} → ${statusLabel(button.dataset.status)}</p><p class="smallnote">${cloudText('비활성화하면 기존 로그인 상태에서도 구단 기록에 접근할 수 없습니다.','Disabled members lose access even if they are already signed in.')}</p></div>`,`<div class="dialogfoot">${btn(cloudText('취소','Cancel'),'close-dialog','close')}<button class="btn primary" data-action="member-change-confirm" data-id="${esc(m.id)}" data-role="${esc(button.dataset.role)}" data-status="${esc(button.dataset.status)}">${cloudText('변경 적용','Apply change')}</button></div>`);
}
async function applyMemberChange(button){
  if(membership.busy)return;membership.busy=true;button.disabled=true;
  try{const {error}=await membership.client.rpc('admin_update_club_member',{p_member_id:button.dataset.id,p_role:button.dataset.role,p_status:button.dataset.status});if(error)throw translateMemberError(error);closeDialog();await checkMember();if(memberAdmin())await loadMembers();offlineToast(cloudText('회원 설정을 변경했습니다.','Member settings updated.'));}
  catch(error){offlineToast(error.message,true);button.disabled=false;}
  finally{membership.busy=false;}
}
function openMemberAccount(){modal(cloudText('내 계정','My account'),`<form id="member-password-form"><div class="dialogbody"><p>${esc(membership.member.display_name)}<br>${esc(membership.user.email)}</p><div class="formerror" id="form-error" role="alert"></div><div class="formgrid"><div class="field"><label for="current-password">${cloudText('현재 비밀번호','Current password')}</label><input id="current-password" name="current" type="password" autocomplete="current-password" required></div><div class="field"><label for="new-password">${cloudText('새 비밀번호 (10자 이상)','New password (10+ characters)')}</label><input id="new-password" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></div><div class="field"><label for="confirm-new-password">${cloudText('새 비밀번호 확인','Confirm new password')}</label><input id="confirm-new-password" name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></div></div></div><div class="dialogfoot">${btn(cloudText('취소','Cancel'),'close-dialog','close')}<button type="submit" class="btn primary">${cloudText('비밀번호 변경','Change password')}</button></div></form>`);}
async function changeMemberPassword(form){
  if(membership.busy)return;const values=new FormData(form);if(values.get('password')!==values.get('confirm'))return formError(cloudText('비밀번호 확인이 일치하지 않습니다.','Passwords do not match.'));
  membership.busy=true;const button=form.querySelector('[type=submit]');button.disabled=true;
  try{const {error}=await membership.client.auth.updateUser({password:values.get('password'),current_password:values.get('current')});if(error)throw translateMemberError(error);closeDialog();offlineToast(cloudText('비밀번호를 변경했습니다.','Password updated.'));}catch(error){formError(error.message);}finally{membership.busy=false;button.disabled=false;}
}
async function memberLogout(force=false){
  if(cloud.draft&&!force){modal(cloudText('저장되지 않은 변경 내용','Unsaved changes'),`<div class="dialogbody"><p>${cloudText('저장되지 않은 내용이 있습니다. 백업을 내려받거나 저장을 완료한 뒤 로그아웃해 주세요. 이 기기에 보관된 변경 내용은 같은 계정으로 다시 로그인하면 복구됩니다.','You have unsaved changes. Download a backup or finish saving before signing out. Your draft can be recovered on this device by signing into the same account.')}</p></div>`,`<div class="dialogfoot">${btn(cloudText('백업 다운로드','Download backup'),'backup','download')}${btn(cloudText('취소','Cancel'),'close-dialog','close')}<button class="btn" data-action="member-logout-confirm">${cloudText('로그아웃','Sign out')}</button></div>`);return;}
  await cloud.cacheQueue;const {error}=await membership.client.auth.signOut({scope:'local'});if(error)throw translateMemberError(error);membership.sync++;membership.user=null;membership.member=null;membership.members=[];membership.query='';clearClubAccess();showMemberLanding();
}
async function pollMember(){
  if(!membership.user||document.visibilityState!=='visible'||membership.busy)return;
  const user=membership.user.id;const {data,error}=await membership.client.from('club_members').select('id,email,display_name,role,status,created_at,updated_at').eq('id',user).single();
  if(membership.user?.id!==user)return;if(error){if(error.code==='PGRST116'||error.status===401)await checkMember();return;}
  if(data.status!==membership.member?.status||data.status!=='active'||data.role!==membership.member?.role){membership.member=data;if(data.status!=='active'){clearClubAccess();showMemberLanding();}else if(!cloud.ready)await loadCloud();else render();return;}
  membership.member=data;
  if(cloud.ready&&!cloud.draft&&!cloud.loading&&!document.querySelector('#dialog[open]')){
    const generation=membership.generation,server=await requestClub();if(generation!==membership.generation||cloud.draft||document.querySelector('#dialog[open]'))return;
    if(server.revision!==cloud.revision){state=server.state;cloud.revision=server.revision;cloud.savedAt=server.savedAt;render();}
  }
}
if(CLOUD_SITE){
  clearClubAccess();
  const readActions=['language','menu','close-dialog','nav','profile','staff-profile','player-tab','subtab','operation-tab','staff-tab','page','reset-filters','backup','csv','print','sort-table','sort-players','schedule-history'];
  document.addEventListener('click',event=>{
    const b=event.target.closest('[data-action]');if(!b||b.disabled)return;const action=b.dataset.action;
    if(action.startsWith('member-')){
      event.preventDefault();event.stopImmediatePropagation();
      const handlers={
        'member-login-tab':()=>{membership.mode='login';showMemberLanding();},'member-signup-tab':()=>{membership.mode='signup';showMemberLanding();},'member-reset-tab':()=>{membership.mode='reset';showMemberLanding();},
        'member-check':checkMember,'member-list':loadMembers,'member-refresh':loadMembers,'member-account':openMemberAccount,'member-change':()=>memberChangeDialog(b),'member-change-confirm':()=>applyMemberChange(b),
        'member-logout':()=>memberLogout(),'member-logout-confirm':()=>memberLogout(true)
      };
      if(['member-list','member-refresh','member-change','member-change-confirm'].includes(action)&&!memberAdmin())return cloudWarning();
      if(action==='member-account'&&!memberActive())return cloudWarning();
      try{Promise.resolve(handlers[action]?.()).catch(error=>offlineToast(error.message,true));}catch(error){offlineToast(error.message,true);}return;
    }
    if(['language','menu','close-dialog'].includes(action))return;
    if(!memberActive()||!cloud.ready){event.preventDefault();event.stopImmediatePropagation();return cloudWarning();}
    if(action==='snapshot'){event.preventDefault();event.stopImmediatePropagation();return;}
    if(action==='cloud-retry'){event.preventDefault();event.stopImmediatePropagation();cloud.attempts=0;if(cloud.draft){cloud.error='';flushCloud();}else loadCloud();return;}
    if(action==='cloud-reload'){event.preventDefault();event.stopImmediatePropagation();modal(cloudText('최신 기록 불러오기','Load latest records'),`<div class="dialogbody"><p>${cloudText('내 변경 내용을 백업한 뒤 최신 기록으로 바꿔 주세요. 이 창의 미저장 변경 내용은 삭제됩니다.','Back up your edits before loading the latest records. This replaces the unsaved draft.')}</p></div>`,`<div class="dialogfoot">${btn(cloudText('내 변경 내용 백업','Back up my changes'),'backup','download')}${btn(cloudText('취소','Cancel'),'close-dialog','close')}${btn(cloudText('최신 기록으로 변경','Load latest records'),'cloud-discard-confirm','refresh','','primary')}</div>`);return;}
    if(action==='cloud-discard-confirm'){event.preventDefault();event.stopImmediatePropagation();closeDialog();loadCloud(true);return;}
    if(cloud.conflict&&!readActions.includes(action)){event.preventDefault();event.stopImmediatePropagation();cloudWarning();}
  },true);
  document.addEventListener('submit',event=>{
    if(event.target.id==='member-auth-form'){event.preventDefault();event.stopImmediatePropagation();submitMemberAuth(event.target);return;}
    if(event.target.id==='member-password-form'){event.preventDefault();event.stopImmediatePropagation();if(memberActive())changeMemberPassword(event.target);return;}
    if(!memberActive()||!cloud.ready||cloud.conflict){event.preventDefault();event.stopImmediatePropagation();cloudWarning();}
  },true);
  document.addEventListener('input',event=>{if(event.target.id==='member-search'){membership.query=event.target.value;const start=event.target.selectionStart;render();const input=document.querySelector('#member-search');input.focus();input.setSelectionRange(start,start);}});
  window.addEventListener('beforeunload',event=>{if(cloud.draft){event.preventDefault();event.returnValue='';}});
  window.addEventListener('online',()=>{if(membership.user){pollMember().catch(()=>{});if(cloud.draft&&!cloud.conflict){cloud.error='';cloud.attempts=0;flushCloud();}}});
  document.addEventListener('visibilitychange',()=>pollMember().catch(()=>{}));
  let previousLanguage=document.documentElement.lang;new MutationObserver(()=>{if(previousLanguage!==document.documentElement.lang){previousLanguage=document.documentElement.lang;if(!cloud.ready)showMemberLanding();else render();}}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  try{
    const url=new URL(clubConfig.supabaseUrl),key=clubConfig.supabasePublishableKey;
    if(url.protocol!=='https:'&&url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')throw Error('Invalid Supabase URL');
    let publicKey=typeof key==='string'&&key.startsWith('sb_publishable_');
    if(!publicKey&&typeof key==='string'&&key.split('.').length===3){try{publicKey=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';}catch{}}
    if(!publicKey||!window.supabase?.createClient)throw Error('Invalid public client configuration');
    membership.client=window.supabase.createClient(url.origin,key,{auth:{storageKey:'chizumulu-members-'+url.hostname,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    membership.client.auth.onAuthStateChange((event,session)=>{
      if(event==='TOKEN_REFRESHED'||event==='USER_UPDATED')return;
      if(event==='PASSWORD_RECOVERY')membership.recovery=true;
      if(event==='SIGNED_OUT'){membership.sync++;membership.user=null;membership.member=null;membership.members=[];membership.query='';clearClubAccess();showMemberLanding();return;}
      setTimeout(()=>syncMemberSession(session),0);
    });
    checkMember().catch(error=>showMemberLanding(error.message));setInterval(()=>pollMember().catch(()=>{}),20000);
  }catch{showMemberLanding();}
}
