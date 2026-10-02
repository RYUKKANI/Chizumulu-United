const assert=require('node:assert/strict'),W=require('../club-workspace-model.js');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
const plan={id:'plan-1',date:'2026-10-02',time:'16:00',type:'전술 훈련',minutes:60,topic:'Pressing transitions'};
test('backups before training plans remain valid',()=>assert.equal(W.validatePlans(undefined),true));
test('plans survive a JSON backup round trip',()=>assert.equal(W.validatePlans(JSON.parse(JSON.stringify([plan]))),true));
test('editing a plan preserves unrelated plans and input',()=>{const initial=[plan,{...plan,id:'plan-2'}],next=W.upsert(initial,{...plan,minutes:75});assert.equal(next.length,2);assert.equal(next[0].minutes,75);assert.equal(initial[0].minutes,60);assert.deepEqual(next[1],initial[1]);});
test('invalid dates are rejected',()=>assert.throws(()=>W.validatePlans([{...plan,date:'2026-02-30'}])));
test('invalid local times are rejected',()=>{for(const time of ['24:00','16:60','4:00'])assert.throws(()=>W.validatePlans([{...plan,time}]))});
test('duplicate plan IDs are rejected',()=>assert.throws(()=>W.validatePlans([plan,plan])));
test('invalid durations are rejected without changing data',()=>{for(const minutes of [0,-1,301,1.5,'60',Infinity])assert.throws(()=>W.upsert([plan],{...plan,minutes}));assert.equal(plan.minutes,60);});
test('structured and overlong notes are rejected',()=>{for(const topic of [{value:'note'},'x'.repeat(2001)])assert.throws(()=>W.validatePlans([{...plan,topic}]))});
test('malformed plan collections are rejected',()=>{for(const value of [null,{},[null]])assert.throws(()=>W.validatePlans(value));});
const match=(id,date,played=false,extra={})=>({id,round:Number(id.replace(/\D/g,''))||1,date,gf:played?1:null,ga:played?0:null,...extra});
test('matchday and the four following days remain recent before moving to past matches',()=>{const f=match('FX1','2026-09-28',true);for(const day of ['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02'])assert.deepEqual(W.fixtureGroups([f],day).recent,[f]);assert.deepEqual(W.fixtureGroups([f],'2026-10-03').played,[f]);});
test('today and upcoming matches are ordered by date rather than round',()=>{const today=match('FX11','2026-10-02'),later=match('FX1','2026-10-20'),next=match('FX14','2026-10-11'),unknown=match('FX2','');const groups=W.fixtureGroups([later,unknown,today,next],'2026-10-02');assert.deepEqual(groups.recent,[today]);assert.deepEqual(groups.upcoming,[next,later,unknown]);});
test('a dated postponed match stays separate while a rescheduled match appears normally',()=>{const postponed=match('FX9','2026-10-02',false,{scheduleStatus:'Postponed'}),rescheduled=match('FX11','2026-10-02',false,{scheduleStatus:'Rescheduled'});const g=W.fixtureGroups([postponed,rescheduled],'2026-10-02');assert.deepEqual(g.postponed,[postponed]);assert.deepEqual(g.recent,[rescheduled]);});
test('older matches without results remain visible for review',()=>{const missing=match('FX12','2026-09-27');assert.deepEqual(W.fixtureGroups([missing],'2026-10-02').pending,[missing]);});
test('known results take precedence over stale status and unknown dates',()=>{const unknown=match('FX1','',true,{scheduleStatus:'Postponed'}),recent=match('FX2','2026-10-01',true,{scheduleStatus:'Postponed'});const g=W.fixtureGroups([unknown,recent],'2026-10-02');assert.deepEqual(g.played,[unknown]);assert.deepEqual(g.recent,[recent]);assert.equal(g.postponed.length,0);});
test('fixture groups preserve every record without modifying saved data',()=>{const fixtures=[match('FX12','2026-09-27',true),match('FX11','2026-10-02'),match('FX9','',false,{scheduleStatus:'Postponed'}),match('FX14','2026-10-11')],snapshot=JSON.stringify(fixtures),g=W.fixtureGroups(fixtures,'2026-10-02');assert.equal(JSON.stringify(fixtures),snapshot);assert.deepEqual(g.all.map(f=>f.id),['FX9','FX11','FX12','FX14']);assert.equal(new Set([...g.recent,...g.upcoming,...g.pending,...g.played,...g.postponed].map(f=>f.id)).size,fixtures.length);});
test('recent dates span year boundaries and invalid dates stay unconfirmed',()=>{const recent=match('FX1','2025-12-30',true),invalid=match('FX2','2026-02-30');const g=W.fixtureGroups([recent,invalid],'2026-01-02');assert.deepEqual(g.recent,[recent]);assert.deepEqual(g.upcoming,[invalid]);assert.throws(()=>W.fixtureGroups([],'2026-02-30'));});
console.log(count+' workspace checks passed.');

