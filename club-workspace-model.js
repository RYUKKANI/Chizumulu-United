(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ClubWorkspaceModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const types=['전술 훈련','기술 훈련','경기 준비','체력 훈련','회복 훈련'];
  function dateValid(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
  function validatePlans(plans){
    if(plans===undefined)return true;
    if(!Array.isArray(plans)||plans.length>5000)throw Error('훈련 계획 형식을 확인해 주세요.');
    const ids=new Set();for(const r of plans){
      if(!r||typeof r!=='object'||Array.isArray(r)||typeof r.id!=='string'||!r.id||r.id.length>100||ids.has(r.id)||!dateValid(r.date)||typeof r.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)||!types.includes(r.type)||!Number.isInteger(r.minutes)||r.minutes<1||r.minutes>300||typeof r.topic!=='string'||r.topic.length>2000)throw Error('훈련 계획의 날짜·시간·내용을 확인해 주세요.');
      ids.add(r.id);
    }return true;
  }
  function upsert(plans,record){validatePlans(plans);const next=(plans||[]).map(r=>({...r})),index=next.findIndex(r=>r.id===record.id),copy={id:record.id,date:record.date,time:record.time,type:record.type,minutes:record.minutes,topic:record.topic};if(index<0)next.push(copy);else next[index]=copy;validatePlans(next);return next;}
  function fixtureGroups(fixtures,today){
    if(!dateValid(today))throw Error('경기 기준 날짜를 확인해 주세요.');
    const cutoff=new Date(Date.parse(today+'T12:00:00Z')-4*86400000).toISOString().slice(0,10);
    const groups={recent:[],upcoming:[],pending:[],played:[],postponed:[],all:[...fixtures]};
    for(const f of fixtures){
      const played=f.gf!=null&&f.ga!=null,dated=dateValid(f.date);
      if(!played&&f.scheduleStatus==='Postponed')groups.postponed.push(f);
      else if(dated&&f.date>=cutoff&&f.date<=today)groups.recent.push(f);
      else if(played)groups.played.push(f);
      else if(dated&&f.date<cutoff)groups.pending.push(f);
      else groups.upcoming.push(f);
    }
    const round=(a,b)=>Number(a.round)-Number(b.round)||String(a.id).localeCompare(String(b.id));
    const date=(a,b)=>(dateValid(a.date)?a.date:'9999-12-31').localeCompare(dateValid(b.date)?b.date:'9999-12-31')||String(a.kickoffTime||'99:99').localeCompare(String(b.kickoffTime||'99:99'))||round(a,b);
    groups.upcoming.sort(date);groups.pending.sort(date);
    groups.recent.sort((a,b)=>-date(a,b));groups.played.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||round(a,b));
    groups.postponed.sort(round);groups.all.sort(round);
    return groups;
  }
  function dailyRecord(state,playerId,date,sessionId='',sessions=[],migrated=false){
    if(!dateValid(date))throw Error('훈련 날짜를 확인해 주세요.');
    const session=migrated?sessions.find(s=>s.id===sessionId&&s.date===date):null;
    if(migrated&&!session)return {record:null,blocked:'session'};
    const rows=(state.training||[]).filter(r=>r.playerId===playerId&&(migrated?r.sessionId===session.id:r.date===date));
    return {record:rows.length===1?rows[0]:null,blocked:rows.length>1?'multiple':'',session};
  }
  function markDailyAttendance(state,options){
    const {playerId,date,sessionId='',sessions=[],migrated=false,status,id,today}=options;
    if(!state.players.some(p=>p.id===playerId&&p.status==='Active')||!dateValid(today)||!dateValid(date)||date>today)throw Error('선수와 훈련 날짜를 확인해 주세요. 미래 출석은 기록할 수 없습니다.');
    if(!['Present','Late','Absent','Excused','Rehab'].includes(status))throw Error('출석 상태를 확인해 주세요.');
    const context=dailyRecord(state,playerId,date,sessionId,sessions,migrated);
    if(context.blocked)throw Error(context.blocked==='session'?'훈련 회차를 먼저 선택해 주세요.':'같은 날짜에 기록이 여러 개입니다. 훈련 기록에서 회차별로 수정해 주세요.');
    if(context.record)context.record.attendance=status;
    else{if(typeof id!=='string'||!id||(state.training||[]).some(r=>r.id===id))throw Error('기록 ID를 확인해 주세요.');state.training.push({id,playerId,date,...(migrated?{sessionId}:{}),type:'기술 훈련',attendance:status,minutes:0,rpe:'',notes:''});}
    if(state.operations?.attendancePlans)delete state.operations.attendancePlans[date+'|'+playerId];
  }
  return {validatePlans,upsert,fixtureGroups,dailyRecord,markDailyAttendance};
});
