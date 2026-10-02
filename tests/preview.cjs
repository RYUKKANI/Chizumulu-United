/* Isolated fixture server. Never forwards requests to the real club. */
const fs=require('fs'),path=require('path'),http=require('http'),zlib=require('zlib'),{randomUUID}=require('crypto'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),accounts=new Map(),owner='10000000-0000-4000-8000-000000000001',coach='10000000-0000-4000-8000-000000000002';
const flagsPath=path.join(root,'work','preview-network.json');fs.mkdirSync(path.dirname(flagsPath),{recursive:true});
async function main(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const n of fs.readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8'));
 for(const [id,email,name,role] of [[owner,'owner@example.test','시험 관리자','admin'],[coach,'coach@example.test','시험 코치','member']]){accounts.set(email,{id,email,password:'TestPassword!10',name});await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,email,JSON.stringify({display_name:name})]);await db.query("update public.club_members set status='active',role=$2 where id=$1",[id,role]);}
 let seed=(await db.query('select state from public.club_state')).rows[0].state;seed.players=[{id:'DEMO-001',number:1,name:'Test Player One',koreanName:'시험 선수 1',position:'GK',status:'Active',availability:'Available',registration:'Registered',photo:''},{id:'DEMO-002',number:2,name:'Test Player Two',koreanName:'시험 선수 2',position:'DF',status:'Active',availability:'Available',registration:'Registered',photo:''}];seed.operations=require('../operations-model').defaults();
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.query('select public.save_club_state($1,1,$2)',[JSON.stringify(seed),randomUUID()]);await db.query('select public.admin_sync_maintenance(true)');await db.query('select public.admin_activate_offline(2,$1)',[owner]);
 const today=require('../operations-model').localDay();const epoch=(await db.query('select sync_epoch from public.sync_heads')).rows[0].sync_epoch;await db.query('select public.apply_club_actions($1)',[JSON.stringify([{schemaVersion:1,syncEpoch:epoch,ownerUserId:owner,mutationId:randomUUID(),kind:'session.create',target:{id:'demo-session'},patch:{date:today,sessionNo:1,name:'시험 원정 훈련'},clientAt:new Date().toISOString()}])]);
 const procedures=new Map((await db.query("select p.proname,p.proargnames,oidvectortypes(p.proargtypes) types from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname not like 'legacy_%' ")).rows.map(x=>[x.proname,x]));
 let pending=Promise.resolve();function sql(user,query,args=[]){const task=pending.then(async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec('set role '+(user?'authenticated':'anon'));return db.query(query,args);});pending=task.catch(()=>{});return task;}
 const user=a=>({id:a.id,email:a.email,aud:'authenticated',role:'authenticated',user_metadata:{display_name:a.name},app_metadata:{provider:'email'},created_at:new Date().toISOString()});
 const session=a=>({access_token:['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:a.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+86400})).toString('base64url'),'fixture'].join('.'),refresh_token:'refresh-'+a.id,expires_in:86400,token_type:'bearer',user:user(a)});
 const media=new Map();
 const metrics={startedAt:new Date().toISOString(),requests:[]};
 const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1:8951'),pathname=/^\/(auth|rest|storage)\//.test(url.pathname)?'/api'+url.pathname:url.pathname;const flags=fs.existsSync(flagsPath)?JSON.parse(fs.readFileSync(flagsPath,'utf8')):{};res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 function send(status,data,contentType='application/json'){let body=Buffer.isBuffer(data)?data:Buffer.from(typeof data==='string'?data:JSON.stringify(data));const raw=body.length;if(/gzip/.test(req.headers['accept-encoding']||'')){body=zlib.gzipSync(body);res.setHeader('Content-Encoding','gzip');}res.setHeader('Content-Type',contentType);res.setHeader('Content-Length',body.length);metrics.requests.push({at:new Date().toISOString(),path:pathname,select:url.searchParams.get('select'),bytes:body.length,uncompressed:raw,method:req.method});res.writeHead(status);res.end(body);}
 if(pathname==='/__test/metrics')return send(200,metrics);
 if(pathname==='/__test/records'){const s=(await sql(owner,'select public.get_club_snapshot() r')).rows[0].r;return send(200,{training:s.training,ledger:s.ledger,seq:s.cursor});}
 if(flags.shellOffline&&!pathname.startsWith('/api/')&&!pathname.startsWith('/__test/'))return send(503,'Fixture offline shell','text/plain');
 if(flags.offline&&(pathname==='/api'||pathname.startsWith('/api/')))return send(503,{message:'Fixture weak signal'});
 let storageUser=null;try{storageUser=JSON.parse(Buffer.from((req.headers.authorization||'').replace('Bearer ','').split('.')[1],'base64url')).sub;}catch{}
 const storagePath=pathname.match(/^\/api\/storage\/v1\/object\/(?:authenticated\/)?club-media\/(.+)$/);
 if(storagePath){
  const name=decodeURIComponent(storagePath[1]),member=storageUser?(await sql(storageUser,'select status from public.club_members where id=$1',[storageUser])).rows[0]:null;
  if(member?.status!=='active')return send(403,{message:'Active membership required'});
  if(req.method==='GET'){const item=media.get(name);return item?send(200,item.bytes,item.type):send(404,{message:'Object not found'});}
  if(req.method==='POST'){
   if(!/^(players|receipts)\/[A-Za-z0-9_-]+\/[A-Fa-f0-9-]+\.(webp|jpg|png)$/.test(name))return send(400,{message:'Invalid object path'});
   const chunks=[];for await(const part of req)chunks.push(part);let bytes=Buffer.concat(chunks),type=req.headers['content-type']||'';
   if(type.startsWith('multipart/form-data')){const boundary=type.match(/boundary=(?:"([^"]+)"|([^;]+))/),marker=Buffer.from('--'+(boundary?.[1]||boundary?.[2]||''));let start=0,found=false;
    while((start=bytes.indexOf(marker,start))>=0){const headerEnd=bytes.indexOf('\r\n\r\n',start),end=bytes.indexOf(Buffer.from('\r\n--'+(boundary?.[1]||boundary?.[2]||'')),headerEnd+4);if(headerEnd<0||end<0)break;const headers=bytes.subarray(start,headerEnd).toString();if(headers.includes('filename=')){type=headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]||'';bytes=bytes.subarray(headerEnd+4,end);found=true;break;}start=end+2;}if(!found)return send(400,{message:'Missing photo'});
   }
   if(bytes.length>61440||!['image/webp','image/png','image/jpeg'].includes(type))return send(400,{message:'Invalid thumbnail size/type'});
   if(media.has(name))return send(409,{message:'The resource already exists',error:'Duplicate'});media.set(name,{bytes,type});return send(200,{Key:'club-media/'+name,Id:randomUUID()});
  }
  return send(405,{message:'Immutable objects'});
 }
 let body={};if(['POST','PUT'].includes(req.method)){try{let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw||'{}');}catch{return send(400,{message:'Invalid JSON'});}}
 let id=null;try{id=JSON.parse(Buffer.from((req.headers.authorization||'').replace('Bearer ','').split('.')[1],'base64url')).sub;}catch{}
 try{
 if(pathname==='/api/auth/v1/token'){const a=body.refresh_token?[...accounts.values()].find(x=>'refresh-'+x.id===body.refresh_token):accounts.get(body.email);return send(a&&(body.refresh_token||a.password===body.password)?200:400,a?session(a):{message:'Invalid login credentials'});}
 if(pathname==='/api/auth/v1/user'){const a=[...accounts.values()].find(x=>x.id===id);return send(a?200:401,a?user(a):{message:'Not authenticated'});}
 if(pathname==='/api/auth/v1/logout')return send(200,{});
 if(pathname.startsWith('/api/rest/v1/rpc/')){const name=pathname.split('/').pop(),p=procedures.get(name);if(!p)return send(404,{code:'PGRST202',message:'Could not find the function'});const types=p.types?p.types.split(', '):[],args=(p.proargnames||[]).map((n,i)=>['json','jsonb'].includes(types[i])?JSON.stringify(body[n]):body[n]);const result=(await sql(id,`select public.${name}(${types.map((t,i)=>'$'+(i+1)+'::'+t).join(',')}) result`,args)).rows[0].result;return send(200,result);}
 if(pathname.startsWith('/api/rest/v1/')){const table=pathname.split('/').pop();if(!['club_state','club_members','sync_heads','player_medical','player_medical_archive'].includes(table))return send(404,{});const selected=(url.searchParams.get('select')||'*');if(!/^[a-z_,*]+$/.test(selected))return send(400,{});let filter='',args=[];for(const key of ['id','club_id'])if(url.searchParams.get(key)){filter=' where '+key+'=$1';args=[url.searchParams.get(key).replace('eq.','')];break;}const rows=(await sql(id,'select '+selected+' from public.'+table+filter,args)).rows;return req.headers.accept?.includes('object')?send(rows[0]?200:406,rows[0]||{code:'PGRST116',message:'No row'}):send(200,rows);}
 if(pathname==='/config.js')return send(200,"window.CLUB_CONFIG={supabaseUrl:'http://127.0.0.1:8951/api',supabasePublishableKey:'sb_publishable_fixture',emailRecoveryEnabled:false};",'text/javascript');
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return send(404,'Not found','text/plain');if(file.endsWith('.woff2'))res.setHeader('Cache-Control','public,max-age=31536000,immutable');send(200,fs.readFileSync(file),({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');
 }catch(e){send(e.code==='42501'?403:e.code==='40001'?409:400,{code:e.code,message:e.message});}});
 await new Promise(r=>server.listen(8951,'127.0.0.1',r));console.log('Isolated club preview: http://127.0.0.1:8951 — owner@example.test / TestPassword!10');
 process.on('SIGINT',async()=>{fs.writeFileSync(path.join(root,'work','preview-metrics.json'),JSON.stringify(metrics,null,2));server.close();await db.close();process.exit(0);});
}
main().catch(e=>{console.error(e.message);process.exit(1);});
