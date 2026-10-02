const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),{webcrypto,randomUUID}=require('crypto'),{indexedDB}=require('fake-indexeddb');
const O=require('../offline-model');
const state={version:1,meta:{club:'Fixture',season:'2026/27',source:'Test',savedAt:new Date().toISOString()},players:[{id:'P1',name:'Player',status:'Active',contractSecret:'do-not-cache'}],training:[],lineups:{},settings:{},operations:require('../operations-model').defaults()};
for(const k of ['baseStats','fixtures','awards','moves','matchLogs','documents','equipment','issues','trips','travelMembers','sponsors','contacts','leagues','competitions','teams','venues','staff','staffHistory'])state[k]=[];
let snapshot={enabled:true,syncEpoch:randomUUID(),cursor:'0',revision:1,savedAt:new Date().toISOString(),state,sessions:[{id:'S1',date:'2026-10-01',sessionNo:1,name:'Fixture'}],training:[],ledger:[],allowances:[],medical:[{playerId:'P1',data:{allergyNote:'do-not-cache-before-pin'}}]};
let sequence=0,receipts=new Map(),dropReply=false,unavailable=false,forceConflict=false,noSession=false;
const storage=new Map(),localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
function context(uid='owner'){
 const client={auth:{getSession:async()=>({data:{session:noSession?null:{user:{id:uid}}},error:null})},rpc(name,args){return {abortSignal(){return (async()=>{if(unavailable)return {data:null,error:{message:'NETWORK',status:503}};
  if(name==='get_club_snapshot')return {data:O.copy(snapshot),error:null};
  if(name==='pull_club_changes'){const changes=snapshot.training.filter(r=>BigInt(r.seq)>BigInt(args.p_after_seq)).map(r=>({domain:'training',record:r,seq:r.seq}));return {data:{changes,nextCursor:String(sequence),hasMore:false,syncEpoch:snapshot.syncEpoch},error:null};}
  if(name==='apply_club_actions'){const results=args.p_actions.map(a=>{if(receipts.has(a.mutationId))return {...receipts.get(a.mutationId),status:'duplicate'};if(forceConflict)return {mutationId:a.mutationId,status:'conflict',version:'2',current:{attendance:'Absent'},fields:{attendance:{base:null,current:'Absent',proposed:'Present'}}};
   sequence++;const record={...a.patch,...a.target,playerId:a.target.playerId,date:'2026-10-01',version:String(sequence),seq:String(sequence)};snapshot.training=snapshot.training.filter(r=>r.id!==record.id).concat(record);const r={status:'applied',mutationId:a.mutationId,record,domain:'training',version:record.version,seq:record.seq,syncEpoch:snapshot.syncEpoch};receipts.set(a.mutationId,r);return r;});if(dropReply){dropReply=false;return {error:{message:'LOST_REPLY',status:503}};}return {data:{results,syncEpoch:snapshot.syncEpoch},error:null};}
  return {data:{},error:null};})();}};},from(){const builder={select(){return builder;},eq(){return builder;},single(){return builder;},retry(){return builder;},abortSignal(){return Promise.resolve({error:{status:unavailable?503:401},status:unavailable?503:401});}};return builder;}};
 const ctx=vm.createContext({console,crypto:webcrypto,indexedDB,AbortSignal,TextEncoder,localStorage,Date,Promise,BigInt,structuredClone,window:{ClubOffline:O,addEventListener(){}},navigator:{onLine:true},document:{visibilityState:'visible',querySelector(){return null;},addEventListener(){}},setTimeout:(f,t)=>{const timer=setTimeout(f,t);timer.unref();return timer;},clearTimeout,
 membership:{client,user:{id:uid},member:{id:uid,status:'active',role:'member',email:uid+'@example.test'},generation:1},cloud:{ready:true,revision:1,draft:null,conflict:false},clubConfig:{supabaseUrl:'http://fixture'},CLOUD_SITE:false,state:O.copy(state),lang:'en',cloudText:(ko,en)=>en,
 render(){},loadCloud(){},save(){},flushCloud(){},pollMember(){},updateSaveStatus(){},memberLogout(){},syncMemberSession(){},memberActive(){return true;},clone:O.copy,validData(){},draftOperation:async()=>null,cacheDraft:async()=>{},translateMemberError:e=>Object.assign(new Error(e.message),e),modal(){},btn(){},offlineToast(){},esc:String,requestRevision:async()=>1,clearClubAccess(){},showMemberLanding(){}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../offline-client.js'),'utf8'),ctx);return ctx;
}
const run=(ctx,code)=>vm.runInContext(code,ctx);
async function main(){let checks=0;const check=x=>{assert.ok(x);checks++;};
 const c=context();await run(c,'loadCloud()');await run(c,'offlineSync.persist');
 let cached=await run(c,"syncStore('get')");check(!JSON.stringify(cached).includes('do-not-cache'));
 unavailable=true;run(c,"offlineSync.connected=false;state.training.push({id:'R1',sessionId:'S1',date:'2026-10-01',playerId:'P1',attendance:'Present',minutes:0,rpe:'',notes:'',type:null});save();");await run(c,'offlineSync.persist');
 check(run(c,'syncCounts().pending')===1);cached=await run(c,"syncStore('get')");const originalId=cached.queue[0].action.mutationId;
 const c2=context();check(await run(c2,"restoreOfflineSession({user:{id:'owner'}},{status:503})"));check(run(c2,"state.training[0].attendance")==='Present');
 const other=context('other');check(!(await run(other,"restoreOfflineSession({user:{id:'other'}},{status:503})")));
 unavailable=false;dropReply=true;await run(c2,'syncNow()');check(run(c2,'syncCounts().pending')===1);cached=await run(c2,"syncStore('get')");check(cached.queue[0].action.mutationId===originalId&&cached.queue[0].attempted);
 await run(c2,'syncNow()');check(run(c2,'syncCounts().pending')===0);check(snapshot.training.length===1&&receipts.size===1);
 check(run(c2,'offlineSync.snapshot.fullState')===true&&run(c2,'state.players[0].contractSecret')==='do-not-cache');
 const base={schemaVersion:1,ownerUserId:'owner',syncEpoch:snapshot.syncEpoch,kind:'training.set',target:{id:'R1',sessionId:'S1',playerId:'P1'},mutationId:randomUUID(),baseRecordExists:true,baseRecordVersion:1,base:{notes:''},patch:{notes:'first'}};
 const q=O.enqueue([{action:base,status:'queued',attempted:true}],[{...base,mutationId:randomUUID(),base:{notes:'first'},patch:{notes:'second'}}]);check(q.length===2&&q[0].action.patch.notes==='first');
 const coalesced=O.enqueue([{action:base,status:'queued',attempted:false}],[{...base,mutationId:randomUUID(),base:{notes:'first'},patch:{notes:'second'}}]);check(coalesced.length===1&&coalesced[0].action.base.notes===''&&coalesced[0].action.patch.notes==='second');
 forceConflict=true;run(c2,"state.training[0].attendance='Late';save();");await run(c2,'offlineSync.persist');await run(c2,'syncNow()');check(run(c2,'syncCounts().conflicts')===1);cached=await run(c2,"syncStore('get')");check(cached.queue[0].status==='conflict');
 run(c2,"offlineSync.bundle.medicalPinned=[{playerId:'P1',data:{allergyNote:'private'}}];offlineSync.bundle.mediaCache=[{path:'private',data:'private'}];");await run(c2,'persistSync()');await run(c2,'purgeOfflineView()');cached=await run(c2,"syncStore('get')");check(cached.snapshot===null&&cached.medicalPinned.length===0&&cached.mediaCache.length===0&&cached.queue.length===1);
 check(!(await run(context(),"restoreOfflineSession({user:{id:'owner'}},{status:503})")));
 check(run(c,'offlineSync.snapshot.cursor')==='0');
 const big=O.applyRows({...snapshot,cursor:'9007199254740993'},[{domain:'training',record:{id:'huge',version:'9007199254740995'}}]);check(big.cursor==='9007199254740993'&&big.training.find(r=>r.id==='huge').version==='9007199254740995');
 const suspects=O.suspects([{id:'a',date:'2026-10-01',amount:5,category:'Boat',paymentMethod:'cash'},{id:'b',date:'2026-10-01',amount:5,category:'Boat',paymentMethod:'cash'}]);check(suspects.has('a')&&suspects.has('b'));
 // A denial never opens cached medical data, and the authorized one-week limit is strict.
 check(!(await run(c,"restoreOfflineSession({user:{id:'owner'}},{status:403})")));
 forceConflict=false;unavailable=false;await run(c,'loadCloud()');await run(c,'offlineSync.persist');
 while(run(c,'offlineSync.busy'))await new Promise(setImmediate);await run(c,'offlineSync.persist');
 cached=await run(c,"syncStore('get')");cached.lastVerified=Date.now()-7*86400000;await run(c,"syncStore('put',"+JSON.stringify(cached)+")");check(!(await run(context(),"restoreOfflineSession({user:{id:'owner'}},{status:503})")));
 cached.lastVerified=Date.now()-6*86400000;await run(c,"syncStore('put',"+JSON.stringify(cached)+")");const authorized=context();check(await run(authorized,"restoreOfflineSession({user:{id:'owner'}},{status:503})"));check(run(authorized,'membership.member.role')==='member');
 noSession=true;await assert.rejects(()=>run(authorized,'syncRPC("get_club_snapshot")'),e=>e.code==='REAUTH_REQUIRED');checks++;noSession=false;
 check(O.equal({a:1,b:2},{b:2,a:1}));assert.throws(()=>O.money('1.005'));checks++;
 check(run(c,'freshOfflineCache({snapshot:{},member:{status:"active"},lastVerified:Date.now()+86400000})')===false);
 const finances=context('finance-test');await run(finances,'loadCloud()');while(run(finances,'offlineSync.busy'))await new Promise(setImmediate);
 unavailable=true;run(finances,"state.operations.finance.allowances.push({id:'A1',playerId:'P1',date:'2026-10-01',amount:100,reason:'Test',voided:false});");await assert.rejects(()=>run(finances,'save()'),e=>e.code==='NETWORK');checks++;check(run(finances,'syncCounts().pending')===0);unavailable=false;
 run(finances,"syncStore=async()=>{throw Error('QUOTA_EXCEEDED');}");await assert.rejects(()=>run(finances,'persistSync()'),e=>e.code==='DEVICE_STORAGE_FAILED');checks++;await run(finances,'syncNow()');check(run(finances,'offlineSync.error').includes('Device storage failed'));
 console.log(`Offline client: ${checks} durable queue, response-loss, isolation, conflict and privacy checks passed`);
}
main().catch(e=>{console.error(e.stack);process.exit(1);});
