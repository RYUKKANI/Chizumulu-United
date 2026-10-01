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
console.log(count+' workspace checks passed.');
