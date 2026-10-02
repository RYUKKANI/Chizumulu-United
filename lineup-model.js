/* Formation slots are stored on existing lineup entries. No network or credentials. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ClubLineup=api;})(typeof window==='object'?window:globalThis,function(){
'use strict';
const shapes={
 '4-3-3':[['LB','LCB','RCB','RB'],['LCM','CM','RCM'],['LW','ST','RW']],
 '4-4-2':[['LB','LCB','RCB','RB'],['LM','LCM','RCM','RM'],['LS','RS']],
 '4-4-1-1':[['LB','LCB','RCB','RB'],['LM','LCM','RCM','RM'],['CF'],['ST']],
 '4-2-2-2':[['LB','LCB','RCB','RB'],['LDM','RDM'],['LAM','RAM'],['LS','RS']],
 '4-2-3-1':[['LB','LCB','RCB','RB'],['LCM','RCM'],['LW','CAM','RW'],['ST']],
 '4-1-2-1-2':[['LB','LCB','RCB','RB'],['CDM'],['LCM','RCM'],['CAM'],['LS','RS']],
 '4-3-2-1':[['LB','LCB','RCB','RB'],['LCM','CM','RCM'],['LAM','RAM'],['ST']],
 '3-1-4-2':[['LCB','CB','RCB'],['CDM'],['LM','LCM','RCM','RM'],['LS','RS']],
 '3-4-1-2':[['LCB','CB','RCB'],['LM','LCM','RCM','RM'],['CAM'],['LS','RS']],
 '3-4-2-1':[['LCB','CB','RCB'],['LM','LCM','RCM','RM'],['LAM','RAM'],['ST']],
 '3-4-3':[['LCB','CB','RCB'],['LM','LCM','RCM','RM'],['LW','ST','RW']],
 '5-2-3':[['LWB','LCB','CB','RCB','RWB'],['LCM','RCM'],['LW','ST','RW']],
 '5-3-2':[['LWB','LCB','CB','RCB','RWB'],['LCM','CM','RCM'],['LS','RS']]
};
const clone=x=>JSON.parse(JSON.stringify(x));
const formation=x=>Object.hasOwn(shapes,x)?x:'4-3-3';
function rowX(row,j){
 if(row.length===1)return 50;
 // Central pairs use the same spacing as the centre backs in a back four.
 if(row.length===2)return 12+(j+1)*76/3;
 if(row.length===3&&(row[1]==='CM'||row[1]==='CB'))return 50+(j-1)*76/3;
 return 12+j*76/(row.length-1);
}
function slots(shape){const rows=shapes[formation(shape)],out=[{id:'GK',group:'GK',x:50,y:91}];rows.forEach((row,i)=>row.forEach((id,j)=>out.push({id,group:i===0?'DF':i===rows.length-1?'FW':'MF',x:rowX(row,j),y:76-i*59/(rows.length-1)})));return out;}
function normalize(draft,players){const next=clone(draft),ss=slots(next.formation),used=new Set();next.formation=formation(next.formation);next.note=next.note||'';for(const r of next.entries){if(r.role!=='Starter'||!ss.some(s=>s.id===r.slot)||used.has(r.slot))delete r.slot;else used.add(r.slot);}
 for(const r of next.entries.filter(r=>r.role==='Starter'&&!r.slot)){const p=players.find(p=>p.id===r.playerId),target=ss.find(s=>!used.has(s.id)&&s.group===p?.position)||ss.find(s=>!used.has(s.id));if(target){r.slot=target.id;used.add(target.id);}}return next;}
function place(draft,pid,target,{players,blockedIds=[],allowedFormerIds=[]}){const p=players.find(p=>p.id===pid);if(!p)throw Error('선수 기록이 없습니다.');if(target!=='remove'&&(blockedIds.includes(pid)||(p.status!=='Active'&&!allowedFormerIds.includes(pid))))throw Error('출전 불가 선수입니다.');const next=clone(draft),old=next.entries.find(r=>r.playerId===pid);if(target==='remove'){next.entries=next.entries.filter(r=>r.playerId!==pid);return next;}if(target!=='bench'&&!slots(next.formation).some(s=>s.id===target))throw Error('배치할 자리를 확인해 주세요.');const entry=old||{playerId:pid,role:'Sub',captain:false,travel:false};if(!old)next.entries.push(entry);if(target==='bench'){entry.role='Sub';entry.captain=false;delete entry.slot;return next;}
 const occupied=next.entries.find(r=>r.role==='Starter'&&r.slot===target&&r.playerId!==pid),oldSlot=entry.role==='Starter'?entry.slot:undefined;if(occupied){if(oldSlot){occupied.slot=oldSlot;}else{occupied.role='Sub';occupied.captain=false;delete occupied.slot;}}entry.role='Starter';entry.slot=target;return next;}
function setFormation(draft,shape,players){if(!Object.hasOwn(shapes,shape))throw Error('포메이션을 확인해 주세요.');return normalize({...clone(draft),formation:shape},players);}
function setCaptain(draft,pid){if(!draft.entries.some(r=>r.playerId===pid&&r.role==='Starter'))throw Error('주장은 선발 선수에서 지정해 주세요.');return {...clone(draft),entries:draft.entries.map(r=>({...clone(r),captain:r.playerId===pid}))};}
function validate(s){for(const [fid,rows] of Object.entries(s.lineups||{})){const f=s.fixtures.find(f=>f.id===fid),used=new Set(),players=new Set();for(const r of rows){if(players.has(r.playerId))throw Error('명단에 같은 선수가 중복되어 있습니다.');players.add(r.playerId);if(r.slot!==undefined){if(!f||typeof r.slot!=='string'||r.role!=='Starter'||!slots(f.formation).some(x=>x.id===r.slot)||used.has(r.slot))throw Error('선발 배치 기록을 확인해 주세요.');used.add(r.slot);}}}return true;}
function validateDraft(draft,players){if(draft.entries.filter(r=>r.role==='Starter').length>11)throw Error('선발은 최대 11명입니다.');if(draft.entries.filter(r=>r.captain).length>1)throw Error('주장은 한 명만 지정해 주세요.');const s={fixtures:[{id:draft.fixtureId,formation:draft.formation}],lineups:{[draft.fixtureId]:draft.entries}};validate(s);if(draft.entries.some(r=>!players.some(p=>p.id===r.playerId)))throw Error('선수 기록이 없습니다.');if(draft.entries.some(r=>r.role==='Starter'&&!r.slot))throw Error('모든 선발 선수의 자리를 배치해 주세요.');return true;}
return {shapes,formation,slots,normalize,place,setFormation,setCaptain,validate,validateDraft};
});
