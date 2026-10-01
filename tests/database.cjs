const fs=require('fs');
const assert=require('node:assert/strict');
const path=require('path');
const {PGlite}=require('@electric-sql/pglite');
async function main(){
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/202610010001_members_and_club.sql'),'utf8'));
  const admin='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002',pending='00000000-0000-4000-8000-000000000003';
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values ($1,'admin@example.test','{"display_name":"관리자"}'),($2,'member@example.test','{"display_name":"선수 담당","role":"admin","status":"active"}'),($3,'pending@example.test','{"display_name":"새 회원"}')`,[admin,member,pending]);
  let checks=0;
  async function as(user,sql,params=[]){await db.exec('reset role');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[user||'']);await db.exec('set role '+(user?'authenticated':'anon'));return db.query(sql,params);}
  async function denied(user,sql,params=[],code='42501'){await assert.rejects(()=>as(user,sql,params),e=>e.code===code);checks++;}
  function check(value){assert.ok(value);checks++;}
  await db.exec(`update public.club_members set role='admin',status='active' where id='${admin}'; update public.club_members set status='active' where id='${member}';`);
  await denied(null,'select * from public.club_state');
  check((await as(member,'select * from public.club_members')).rows.length===1);
  check((await as(member,'select role,status from public.club_members')).rows[0].role==='member');
  check((await as(pending,'select * from public.club_state')).rows.length===0);
  await denied(member,`update public.club_members set role='admin' where id=$1`,[member]);
  await denied(member,`select public.admin_update_club_member($1,'admin','active')`,[member]);
  await denied(member,`update public.club_state set revision=revision+1`);
  await denied(pending,`select public.save_club_state('{}',1,$1)`,['00000000-0000-4000-8000-000000000010']);
  check((await as(member,'select * from public.club_member_audit')).rows.length===0);
  await as(admin,`select public.admin_update_club_member($1,'member','active')`,[pending]);
  check((await as(pending,'select * from public.club_state')).rows.length===1);
  check((await as(admin,'select * from public.club_member_audit')).rows.length===1);
  await denied(admin,`select public.admin_update_club_member($1,'member','active')`,[admin],'23514');
  await denied(admin,`select public.admin_update_club_member($1,'admin','disabled')`,[admin],'23514');
  const state=(await as(member,'select state from public.club_state')).rows[0].state;
  const mutation1='00000000-0000-4000-8000-000000000011',mutation2='00000000-0000-4000-8000-000000000012';
  const saved=await as(member,`select public.save_club_state($1,1,$2) result`,[JSON.stringify(state),mutation1]);
  check(saved.rows[0].result.revision===2);
  const repeat=await as(member,`select public.save_club_state($1,1,$2) result`,[JSON.stringify(state),mutation1]);check(repeat.rows[0].result.revision===2);
  await denied(pending,`select public.save_club_state($1,2,$2)`,[JSON.stringify(state),mutation1]);
  await denied(pending,`select public.save_club_state($1,1,$2)`,[JSON.stringify(state),mutation2],'40001');
  const saved2=await as(pending,`select public.save_club_state($1,2,$2) result`,[JSON.stringify(state),mutation2]);check(saved2.rows[0].result.revision===3);
  await denied(member,`select public.save_club_state($1,1,$2)`,[JSON.stringify(state),mutation1],'40001');
  await as(admin,`select public.admin_update_club_member($1,'member','disabled')`,[member]);
  check((await as(member,'select * from public.club_state')).rows.length===0);
  await denied(member,`select public.save_club_state($1,3,$2)`,[JSON.stringify(state),'00000000-0000-4000-8000-000000000013']);
  await denied(pending,`select public.save_club_state('{}',3,$1)`,['00000000-0000-4000-8000-000000000014'],'22023');
  await as(admin,`select public.admin_update_club_member($1,'admin','active')`,[pending]);
  await as(admin,`select public.admin_update_club_member($1,'member','active')`,[admin]);
  await denied(pending,`select public.admin_update_club_member($1,'member','active')`,[pending],'23514');
  await denied(admin,`select public.admin_update_club_member($1,'admin','active')`,[admin]);
  await db.exec('reset role');await db.query(`update auth.users set email='updated@example.test' where id=$1`,[member]);
  check((await as(member,'select email from public.club_members')).rows[0].email==='updated@example.test');
  await db.close();console.log(`Database: ${checks} authorization, approval, audit and save checks passed`);
}
main().catch(error=>{console.error(error);process.exit(1);});
