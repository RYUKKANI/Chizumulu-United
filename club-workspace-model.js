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
  return {validatePlans,upsert};
});
