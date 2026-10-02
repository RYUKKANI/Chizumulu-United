/* Data-only adapter. Confirmed server rows and local proposals always remain separate. */
(function(root){'use strict';
 const copy=x=>JSON.parse(JSON.stringify(x));
 const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
 const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
 const defaults={attendance:null,minutes:0,rpe:null,notes:'',type:null};
 const playerFields=['id','number','name','koreanName','position','status','leadership','availability','returnDate','registration','nationality','photoPath'];
 function medicalForOffline(rows){const fields=['contactName','contactRelationship','contactPhone','allergyStatus','allergyNote','source','confirmedAt'];return rows.map(m=>({playerId:m.playerId,version:m.version,data:Object.fromEntries(fields.filter(k=>m.data[k]!==undefined).map(k=>[k,m.data[k]]))}));}
 function project(s){
  const arrays=['players','baseStats','fixtures','awards','moves','matchLogs','training','documents','equipment','issues','trips','travelMembers','sponsors','contacts','leagues','competitions','teams','venues','staff','staffHistory'];
  const p={version:1,meta:copy(s.meta),lineups:copy(s.lineups),settings:copy(s.settings||{})};
  for(const k of arrays)p[k]=['baseStats','fixtures','matchLogs','training','equipment','issues','trips','travelMembers','leagues','competitions','teams','venues'].includes(k)?copy(s[k]||[]):[];
  p.players=s.players.map(r=>Object.fromEntries(playerFields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]])));
  p.operations=copy(s.operations);p.operations.activity=[];
  p.trainingPlans=copy(s.trainingPlans||[]);
  // Only these top-level domains and player fields may enter the offline view.
  return p;
 }
 function legacy(s){const p=copy(s);p.training=[];p.operations.finance.transactions=[];p.operations.finance.allowances=[];p.meta.syncFormat=1;for(const player of p.players)if(player.photoPath)player.photo='';delete p.syncBackup;return p;}
 function legacyComparable(s){const p=legacy(s);delete p.meta.savedAt;p.operations.activity=[];return p;}
 function operational(s){return {training:copy(s.training||[]),ledger:copy(s.operations?.finance?.transactions||[]),allowances:copy(s.operations?.finance?.allowances||[])};}
 function display(r){const p=copy(r);if(p.amount!==undefined)p.amount=Number(p.amount);if(p.rpe===null)p.rpe='';return p;}
 function merge(snapshot){const s=copy(snapshot.state);if(!s.operations)s.operations={version:1,finance:{openingBalance:0,transactions:[],allowances:[]}};
  if(snapshot.enabled){s.training=(snapshot.training||[]).filter(r=>!r.deleted).map(display);s.operations.finance.transactions=(snapshot.ledger||[]).map(display);s.operations.finance.allowances=(snapshot.allowances||[]).map(display);}return s;
 }
 function money(n){const value=Number(n),cents=Math.round(value*100);if(!Number.isFinite(value)||value<=0||value>=1e12||!Number.isSafeInteger(cents)||Math.abs(value-cents/100)>1e-8)throw Error('금액은 소수 둘째 자리까지 입력해 주세요.');return value.toFixed(2);}
 function normalize(r,domain){const p=copy(r);for(const k of ['version','updatedBy','serverAt','actor','actorName','at'])delete p[k];if(domain==='training'){if(p.rpe==='')p.rpe=null;}else if(p.amount!==undefined)p.amount=money(p.amount);return p;}
 const targetKey=a=>a.kind.startsWith('training.')?(a.target.sessionId?'training:'+a.target.sessionId+'|'+a.target.playerId:'training:'+a.target.id):(a.kind.startsWith('allowance.')&&a.kind!=='allowance.pay'?'allowances:':'ledger:')+a.target.id;
 function diff(before,after,sessions,meta){const actions=[];
  for(const domain of ['training','ledger','allowances']){
   const old=new Map(before[domain].map(r=>[r.id,r])),next=new Map(after[domain].map(r=>[r.id,r]));
   for(const [id,r] of next){const previous=old.get(id),p=normalize(r,domain),base=previous?normalize(previous,domain):null;if(base&&equal(base,p))continue;
    let kind,target={id},patch,extra={baseRecordVersion:previous?.version||0};
    if(domain==='training'){
     if(previous&&(r.date!==previous.date||r.playerId!==previous.playerId||r.sessionId!==previous.sessionId))throw Error('기록의 선수·훈련 회차는 변경할 수 없습니다. 새 회차에 기록해 주세요.');
     let sessionId=r.sessionId||previous?.sessionId;
     if(!sessionId&&!previous){const found=sessions.filter(s=>s.date===r.date);if(found.length!==1)throw Error('온라인에서 훈련 회차를 선택·생성한 뒤 출석을 기록해 주세요.');sessionId=found[0].id;}
     target={id,sessionId:sessionId||null,playerId:r.playerId};patch={};const b={};
     for(const k of Object.keys(defaults))if(!equal(base?.[k]??defaults[k],p[k]??defaults[k])){patch[k]=p[k]??defaults[k];b[k]=base?.[k]??defaults[k];}
     if(!Object.keys(patch).length)continue;kind='training.set';extra={...extra,baseRecordExists:!!previous,base:previous?b:{}};
    }else{kind=domain==='allowances'?(previous?(p.voided&&!base.voided?'allowance.void':'allowance.update'):'allowance.add'):(previous?(p.voided&&!base.voided?'expense.void':'expense.update'):(p.allowanceId?'allowance.pay':'expense.add'));patch=previous?Object.fromEntries(Object.entries(p).filter(([k,v])=>!equal(v,base[k]))):p;delete patch.id;}
    actions.push({...meta,mutationId:crypto.randomUUID(),kind,target,patch,...extra});
   }
   for(const [id,r] of old)if(!next.has(id)){if(domain!=='training')throw Error('장부와 수당은 삭제 대신 취소 처리해 주세요.');actions.push({...meta,mutationId:crypto.randomUUID(),kind:'training.remove',target:{id,sessionId:r.sessionId||null,playerId:r.playerId},patch:{},baseRecordVersion:r.version||1});}
  }return actions;
 }
 function enqueue(queue,actions){const q=copy(queue);for(const a of actions){const found=q.findLast(e=>!e.attempted&&e.status==='queued'&&targetKey(e.action)===targetKey(a));
   if(found&&found.action.kind===a.kind&&a.kind==='training.set'){
    found.action.base={...a.base,...found.action.base};found.action.patch={...found.action.patch,...a.patch};
   }else if(found&&['expense.add','allowance.add','allowance.pay'].includes(found.action.kind)&&['expense.update','allowance.update'].includes(a.kind))found.action.patch={...found.action.patch,...a.patch};
   else q.push({action:a,attempted:false,status:'queued'});
  }return q;
 }
 function applyRows(snapshot,changes){const next=copy(snapshot);for(const c of changes){const key=c.domain;if(!['training','ledger','allowances','sessions'].includes(key))throw Error('알 수 없는 동기화 기록입니다.');const rows=next[key]||[],i=rows.findIndex(r=>r.id===c.record.id);if(i<0)rows.push(c.record);else rows[i]=c.record;next[key]=rows;}return next;}
 function optimistic(snapshot,queue){const next=copy(snapshot);for(const e of queue.filter(e=>e.status==='queued'||e.status==='conflict')){const a=e.action,d=a.kind.startsWith('training.')?'training':a.kind.startsWith('session.')?'sessions':a.kind.startsWith('allowance.')&&a.kind!=='allowance.pay'?'allowances':'ledger';
   const rows=next[d]||[],i=rows.findIndex(r=>r.id===a.target.id||(d==='training'&&a.target.sessionId&&r.sessionId===a.target.sessionId&&r.playerId===a.target.playerId));
   const old=i>=0?rows[i]:d==='training'?defaults:{};
   const r={...old,...a.patch,id:old.id||a.target.id,version:(BigInt(old.version||0)+1n).toString()};
   if(d==='training'){r.sessionId=a.target.sessionId;r.playerId=a.target.playerId;r.date=old.date||next.sessions.find(s=>s.id===a.target.sessionId)?.date;if(a.kind==='training.remove')r.deleted=true;}
   if(a.kind.endsWith('.void'))r.voided=true;
   if(i<0)rows.push(r);else rows[i]=r;next[d]=rows;
  }return next;}
 function suspects(rows){const marked=new Set(),keys=new Map();for(const t of rows.filter(x=>!x.voided)){const ref=(t.transactionRef||'').trim(),key=ref?'ref:'+ref:[t.tripId||t.fixtureId||'',t.date,t.amount,t.category,t.paymentMethod||'cash'].join('|');if(!ref&&(t.paymentMethod||'cash')!=='cash')continue;if(keys.has(key)){marked.add(t.id);marked.add(keys.get(key));}else keys.set(key,t.id);}return marked;}
 const api={copy,equal,defaults,project,legacy,legacyComparable,operational,display,merge,money,normalize,diff,targetKey,enqueue,applyRows,optimistic,suspects,medicalForOffline};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ClubOffline=api;
})(typeof window==='object'?window:globalThis);
