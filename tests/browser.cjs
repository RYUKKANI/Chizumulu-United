const fs=require('fs'),assert=require('node:assert/strict'),crypto=require('crypto'),path=require('path'),http=require('http');
const {chromium}=require('playwright');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
async function main(){
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/202610010001_members_and_club.sql'),'utf8'));
  const accounts=new Map(),adminId=crypto.randomUUID();
  accounts.set('admin@example.test',{id:adminId,email:'admin@example.test',password:'AdminPassword!10',user_metadata:{display_name:'구단 관리자'}});
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)`,[adminId,'admin@example.test',JSON.stringify({display_name:'구단 관리자'})]);await db.query(`update public.club_members set role='admin',status='active' where id=$1`,[adminId]);
  function token(a){return ['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:a.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'test'].join('.');}
  function session(a){return {access_token:token(a),refresh_token:'refresh-'+a.id,token_type:'bearer',expires_in:3600,user:{id:a.id,email:a.email,aud:'authenticated',role:'authenticated',user_metadata:a.user_metadata,app_metadata:{provider:'email'},created_at:new Date().toISOString()}};}
  let queue=Promise.resolve(),forceConflict=false;
  async function sql(user,query,params=[]){const operation=queue.then(async()=>{await db.exec('reset role');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[user||'']);await db.exec('set role '+(user?'authenticated':'anon'));return db.query(query,params);});queue=operation.catch(()=>{});return operation;}
  async function routeBackend(route){
    const req=route.request(),url=new URL(req.url()),body=req.postDataJSON()||{};let status=200,data={};
    const authorization=req.headers().authorization||'';let user=null;try{user=JSON.parse(Buffer.from(authorization.replace('Bearer ','').split('.')[1],'base64url')).sub;}catch{}
    try{
      if(url.pathname==='/auth/v1/token'){
        const a=accounts.get(body.email);if(!a||a.password!==body.password){status=400;data={message:'Invalid login credentials',code:'invalid_credentials'};}else data=session(a);
      }else if(url.pathname==='/auth/v1/signup'){
        if(accounts.has(body.email)){status=422;data={msg:'User already registered'};}else{const a={id:crypto.randomUUID(),email:body.email,password:body.password,user_metadata:body.data||{}};accounts.set(a.email,a);await sql(null,'select 1');await queue;await db.exec('reset role');await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[a.id,a.email,JSON.stringify(a.user_metadata)]);data=session(a);}
      }else if(url.pathname==='/auth/v1/user'){
        const a=[...accounts.values()].find(a=>a.id===user);if(!a){status=401;data={msg:'Not authenticated'};}else if(req.method()==='PUT'){if(body.current_password&&body.current_password!==a.password){status=400;data={msg:'Invalid login credentials'};}else{a.password=body.password;data=session(a).user;}}else data=session(a).user;
      }else if(url.pathname==='/auth/v1/logout')data={};
      else if(url.pathname==='/rest/v1/club_members'){
        const id=url.searchParams.get('id')?.replace('eq.','');const rows=(await sql(user,'select * from public.club_members'+(id?' where id=$1':' order by created_at desc'),id?[id]:[])).rows;
        const single=req.headers().accept?.includes('object');if(single&&!rows.length){status=406;data={code:'PGRST116',message:'No row'};}else data=single?rows[0]:rows;
      }else if(url.pathname==='/rest/v1/club_state'){
        const rows=(await sql(user,'select * from public.club_state where id=1')).rows;data=rows[0];if(!data){status=406;data={code:'PGRST116',message:'No row'};}
      }else if(url.pathname==='/rest/v1/rpc/admin_update_club_member'){
        data=(await sql(user,'select public.admin_update_club_member($1,$2,$3) result',[body.p_member_id,body.p_role,body.p_status])).rows[0].result;
      }else if(url.pathname==='/rest/v1/rpc/save_club_state'){
        if(forceConflict){forceConflict=false;const current=(await sql(adminId,'select state,revision from public.club_state')).rows[0];await sql(adminId,'select public.save_club_state($1,$2,$3)',[JSON.stringify(current.state),current.revision,crypto.randomUUID()]);throw Object.assign(new Error('SAVE_CONFLICT'),{code:'40001'});}
        data=(await sql(user,'select public.save_club_state($1,$2,$3) result',[JSON.stringify(body.p_state),body.p_base_revision,body.p_mutation_id])).rows[0].result;
      }else{status=404;data={message:url.pathname};}
    }catch(error){status=error.code==='42501'?403:error.code==='40001'?409:400;data={code:error.code,message:error.message};}
    await route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
  }
  const server=http.createServer((req,res)=>{let file=path.resolve(root,'.'+req.url.split('?')[0]);if(file===root)file=path.join(root,'index.html');if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)]||'application/octet-stream');res.end(data);});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  const errors=[];
  async function pageFor(configured=true,mobile=false){
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});
    await context.route('**/config.js',r=>r.fulfill({contentType:'text/javascript',body:configured?"window.CLUB_CONFIG={supabaseUrl:'https://club-test.supabase.co',supabasePublishableKey:'sb_publishable_test',emailRecoveryEnabled:false};":"window.CLUB_CONFIG={};"}));if(configured)await context.route('https://club-test.supabase.co/**',routeBackend);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);return page;
  }
  async function login(page,email,password){await page.locator('#member-email').fill(email);await page.locator('#member-password').fill(password);await page.locator('#member-auth-form [type=submit]').click();}
  const setup=await pageFor(false);await setup.getByRole('heading',{name:'회원 서비스 준비 중'}).waitFor();await setup.close();
  const member=await pageFor(true,true);await member.locator('[data-action=member-signup-tab]').click();
  await member.locator('#member-name').fill('<img src=x onerror=alert(1)> 담당자');await member.locator('#member-email').fill('member@example.test');await member.locator('#member-password').fill('MemberPassword!10');await member.locator('#member-password-confirm').fill('WrongPassword!10');await member.locator('#member-auth-form [type=submit]').click();await member.getByText('비밀번호 확인이 일치하지 않습니다.').waitFor();
  await member.locator('#member-password').fill('MemberPassword!10');await member.locator('#member-password-confirm').fill('MemberPassword!10');await member.locator('#member-auth-form [type=submit]').click();await member.getByRole('heading',{name:'관리자 승인 대기'}).waitFor();assert.equal(await member.locator('#content img').count(),0);
  await member.screenshot({path:'work/pending-mobile.png',fullPage:true});
  const admin=await pageFor();await login(admin,'admin@example.test','WrongPassword');await admin.getByText('이메일 또는 비밀번호를 확인해 주세요.').waitFor();await login(admin,'admin@example.test','AdminPassword!10');await admin.locator('.account-bar').waitFor();await admin.locator('.account-bar [data-action=member-list]').click();await admin.getByRole('heading',{name:'회원 관리',exact:true}).waitFor();
  const row=admin.locator('tr').filter({hasText:'member@example.test'});await row.locator('[data-status=active]').click();await admin.locator('[data-action=member-change-confirm]').click();await row.getByText('사용 중',{exact:true}).waitFor();
  await member.locator('[data-action=member-check]').click();await member.locator('.account-bar').waitFor();assert.equal(await member.locator('[data-action=member-list]').count(),0);
  // A real player edit exercises the original UI, SDK, save RPC and database.
  await member.locator('.menu-toggle').click();await member.locator('[data-action=nav][data-view=players]').first().click();
  await member.locator('[data-action=new-player]').click();
  await member.locator('#player-form [name=name]').fill('Test Player');await member.locator('#player-form [name=number]').fill('9');await member.locator('#player-form [type=submit]').click();await member.locator('#save-status').filter({hasText:'사이트에 저장됨'}).waitFor();
  assert.equal((await sql(adminId,'select state from public.club_state')).rows[0].state.players[0].name,'Test Player');
  await member.locator('.menu-toggle').click();await member.locator('[data-action=nav][data-view=data]').first().click();assert.equal(await member.locator('[data-action=snapshot]').count(),0);assert.equal(await member.locator('[data-action=backup]').count(),1);
  await member.reload();await member.locator('.account-bar').waitFor();await member.locator('.menu-toggle').click();await member.locator('[data-action=nav][data-view=players]').first().click();await member.getByText('Test Player',{exact:true}).first().waitFor();
  await admin.locator('[data-action=member-refresh]').click();await admin.screenshot({path:'work/members-desktop.png',fullPage:true});
  // Last administrator protection reports a clear error and keeps access.
  const adminRow=admin.locator('tr').filter({hasText:'admin@example.test'});await adminRow.locator('[data-role=member]').click();await admin.locator('[data-action=member-change-confirm]').click();await admin.getByText('마지막 관리자 계정은 비활성화하거나 일반 회원으로 변경할 수 없습니다.',{exact:true}).waitFor();await admin.locator('[data-action=close-dialog]').first().click();
  // Permission revocation is effective for the member's existing session.
  await row.locator('[data-status=disabled]').click();await admin.locator('[data-action=member-change-confirm]').click();await row.getByText('비활성',{exact:true}).waitFor();
  await member.reload();await member.getByRole('heading',{name:'비활성화된 계정입니다'}).waitFor();assert.equal(await member.getByText('Test Player',{exact:true}).count(),0);
  await row.locator('[data-status=active]').click();await admin.locator('[data-action=member-change-confirm]').click();await member.locator('[data-action=member-check]').click();await member.locator('.account-bar').waitFor();
  // A rejected concurrent save must leave a recoverable draft, not a success toast.
  forceConflict=true;await member.locator('[data-action=edit-player]').first().click();await member.locator('#player-form [name=name]').fill('Conflicting Edit');await member.locator('#player-form [type=submit]').click();await member.locator('#cloud-banner').filter({hasText:'다른 회원이 같은 기록을 수정했습니다.'}).waitFor();assert.equal((await sql(adminId,'select state from public.club_state')).rows[0].state.players[0].name,'Test Player');
  await member.reload();await member.locator('#cloud-banner').filter({hasText:'다른 회원이 같은 기록을 수정했습니다.'}).waitFor();
  await member.locator('[data-action=cloud-reload]').click();await member.locator('[data-action=cloud-discard-confirm]').click();await member.getByText('Test Player',{exact:true}).first().waitFor();
  // Account switch removes roster data and the session survives a normal reload.
  await member.locator('[data-action=member-logout]').click();await member.locator('#member-auth-form').waitFor();assert.equal(await member.getByText('Test Player',{exact:true}).count(),0);
  await login(member,'member@example.test','MemberPassword!10');await member.locator('.account-bar').waitFor();
  await member.locator('.account-bar [data-action=member-account]').click();await member.locator('#current-password').fill('MemberPassword!10');await member.locator('#new-password').fill('ChangedPassword!10');await member.locator('#confirm-new-password').fill('ChangedPassword!10');await member.locator('#member-password-form [type=submit]').click();await member.locator('#dialog').waitFor({state:'hidden'});
  await member.locator('[data-action=member-logout]').click();await login(member,'member@example.test','ChangedPassword!10');await member.locator('.account-bar').waitFor();
  assert.deepEqual(errors,[]);await browser.close();await db.close();server.close();console.log('Browser: signup, approval, login, member management, password change, save, conflict recovery, session and mobile checks passed');
}
main().catch(error=>{console.error(error);process.exit(1);});
