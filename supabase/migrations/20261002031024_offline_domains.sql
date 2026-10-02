begin;
-- The head lock serializes commit order as well as cursor allocation. Direct writes are revoked.
create table public.sync_heads (
  club_id integer primary key references public.club_state(id),
  seq bigint not null default 0 check(seq>=0),
  sync_epoch uuid not null default gen_random_uuid(),
  enabled boolean not null default false,
  maintenance boolean not null default false,
  migrated_revision bigint,
  schema_version integer not null default 1
);
alter table public.sync_heads add column medical_revision bigint not null default 0;
insert into public.sync_heads(club_id) values(1);
create table public.training_sessions (
  club_id integer not null references public.sync_heads(club_id), id text not null,
  date date not null, session_no integer not null check(session_no between 1 and 20),
  data jsonb not null, version bigint not null default 1,
  primary key(club_id,id), unique(club_id,date,session_no)
);
create table public.training_records (
  club_id integer not null references public.sync_heads(club_id), id text not null,
  session_id text, player_id text not null, data jsonb not null,
  version bigint not null default 1, deleted boolean not null default false,
  primary key(club_id,id), foreign key(club_id,session_id) references public.training_sessions(club_id,id),
  unique(club_id,session_id,player_id)
);
create table public.allowance_records (
  club_id integer not null references public.sync_heads(club_id), id text not null,
  player_id text not null, amount numeric(18,2) not null check(amount>0),
  data jsonb not null, version bigint not null default 1,
  primary key(club_id,id)
);
create table public.ledger_transactions (
  club_id integer not null references public.sync_heads(club_id), id text not null,
  allowance_id text, amount numeric(18,2) not null check(amount>0),
  data jsonb not null, version bigint not null default 1,
  primary key(club_id,id), foreign key(club_id,allowance_id) references public.allowance_records(club_id,id)
);
create index ledger_allowance on public.ledger_transactions(club_id,allowance_id) where allowance_id is not null;
create index training_player on public.training_records(club_id,player_id);
create table public.change_log (
  club_id integer not null references public.sync_heads(club_id), seq bigint not null,
  domain text not null, record_id text not null, record jsonb not null,
  primary key(club_id,seq)
);
create table club_private.mutation_receipts (
  mutation_id uuid primary key, owner_id uuid not null references auth.users(id),
  request jsonb not null, result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table club_private.cutover_backups (
  club_id integer not null, sync_epoch uuid not null, revision bigint not null,
  state jsonb not null, created_at timestamptz not null default clock_timestamp(), primary key(club_id,sync_epoch)
);
create table public.player_medical (
  club_id integer not null references public.sync_heads(club_id), player_id text not null,
  data jsonb not null, version bigint not null default 1, updated_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(), primary key(club_id,player_id)
);
create table public.player_medical_archive (
  id uuid primary key default gen_random_uuid(), club_id integer not null,
  player_id text not null, data jsonb not null, archived_at timestamptz not null default clock_timestamp(),
  archived_by uuid references auth.users(id)
);
create index medical_archive_player on public.player_medical_archive(club_id,player_id);
create table club_private.medical_archive_access (
  user_id uuid primary key references auth.users(id), is_owner boolean not null default false,
  granted_by uuid references auth.users(id), granted_at timestamptz not null default clock_timestamp()
);
alter table club_private.mutation_receipts enable row level security;
alter table club_private.cutover_backups enable row level security;
alter table club_private.medical_archive_access enable row level security;
revoke all on club_private.mutation_receipts,club_private.cutover_backups,club_private.medical_archive_access from public,anon,authenticated;
create function club_private.archive_reader() returns boolean language sql stable security definer set search_path='' as $$
  select club_private.is_active_member() and exists(select 1 from club_private.medical_archive_access where user_id=auth.uid());
$$;
revoke all on function club_private.archive_reader() from public,anon;
grant execute on function club_private.archive_reader() to authenticated;
do $$ declare t text; begin
  foreach t in array array['sync_heads','training_sessions','training_records','allowance_records','ledger_transactions','change_log','player_medical','player_medical_archive'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    if t='player_medical_archive' then
      execute format('create policy archive_read on public.%I for select to authenticated using (club_id=1 and (select club_private.archive_reader()))',t);
    else
      execute format('create policy approved_read on public.%I for select to authenticated using (club_id=1 and (select club_private.is_active_member()))',t);
    end if;
  end loop;
end $$;

create function club_private.require_member() returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.club_members where id=auth.uid() and status='active' for share;
  if not found then raise exception 'ACTIVE_MEMBER_REQUIRED' using errcode='42501'; end if;
end $$;
create function club_private.emit_change(p_domain text,p_id text,p_record jsonb) returns bigint language plpgsql set search_path='' as $$
declare n bigint; begin
  update public.sync_heads set seq=seq+1 where club_id=1 returning seq into n;
  insert into public.change_log values(1,n,p_domain,p_id,p_record);return n;
end $$;
create function club_private.money(p_value jsonb) returns numeric language plpgsql immutable set search_path='' as $$
declare n numeric; begin
  if jsonb_typeof(p_value)<>'string' or (p_value#>>'{}')!~'^[0-9]{1,16}(\.[0-9]{1,2})?$' then raise exception 'INVALID_AMOUNT' using errcode='22023'; end if;
  n=(p_value#>>'{}')::numeric(18,2);if n<=0 or n>=1000000000000 then raise exception 'INVALID_AMOUNT' using errcode='22023';end if;return n;
end $$;
create function club_private.active_player(p_id text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.club_state s,jsonb_array_elements(s.state->'players') p where s.id=1 and p->>'id'=p_id and p->>'status'='Active');
$$;
create function club_private.training_defaults() returns jsonb language sql immutable set search_path='' as $$
 select '{"attendance":null,"minutes":0,"rpe":null,"notes":"","type":null}'::jsonb;
$$;
create function club_private.apply_action(a jsonb) returns jsonb language plpgsql set search_path='' as $$
#variable_conflict use_column
<<apply_action>>
declare
 kind text:=a->>'kind'; target jsonb:=a->'target'; patch jsonb:=coalesce(a->'patch',a->'payload');
 id text:=target->>'id'; base bigint:=coalesce((a->>'baseRecordVersion')::bigint,0);
 row_data jsonb; new_data jsonb; current_version bigint:=0; n bigint; field text; conflicts jsonb:='{}';
 tr public.training_records; se public.training_sessions; le public.ledger_transactions; al public.allowance_records;
 session_id text:=target->>'sessionId'; pid text:=target->>'playerId'; amount numeric; paid numeric; linked text;
 now_at timestamptz:=clock_timestamp(); defaults jsonb:=club_private.training_defaults(); existed boolean;
begin
 if jsonb_typeof(target) is distinct from 'object' or jsonb_typeof(patch) is distinct from 'object' or id is null or length(id)=0 or length(id)>160 then raise exception 'INVALID_ACTION' using errcode='22023';end if;
 if kind like 'expense.%' or kind='allowance.pay' then
   for field in select jsonb_object_keys(patch) loop
     if field not in ('date','type','category','description','amount','fixtureId','tripId','paymentMethod','transactionRef','receiptPath','playerId','allowanceId','voided','at','actorId','actorName') then raise exception 'INVALID_LEDGER_FIELD' using errcode='22023';end if;
     if field='voided' then
       if jsonb_typeof(patch->field) is distinct from 'boolean' then raise exception 'INVALID_LEDGER_FIELD' using errcode='22023';end if;
     elsif jsonb_typeof(patch->field) is distinct from 'string' then raise exception 'INVALID_LEDGER_FIELD' using errcode='22023';end if;
   end loop;
 elsif kind like 'allowance.%' then
   for field in select jsonb_object_keys(patch) loop
     if field not in ('date','playerId','reason','amount','fixtureId','voided','at','actorId','actorName') then raise exception 'INVALID_ALLOWANCE_FIELD' using errcode='22023';end if;
     if field='voided' then
       if jsonb_typeof(patch->field) is distinct from 'boolean' then raise exception 'INVALID_ALLOWANCE_FIELD' using errcode='22023';end if;
     elsif jsonb_typeof(patch->field) is distinct from 'string' then raise exception 'INVALID_ALLOWANCE_FIELD' using errcode='22023';end if;
   end loop;
 end if;
 if kind='session.create' then
   for field in select jsonb_object_keys(patch) loop
    if field not in ('date','sessionNo','name') then raise exception 'INVALID_SESSION_FIELD' using errcode='22023';end if;
   end loop;
   if patch->>'date'!~'^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(patch->'sessionNo') is distinct from 'number' or jsonb_typeof(patch->'name') is distinct from 'string' or length(patch->>'name')>200 then raise exception 'INVALID_SESSION' using errcode='22023';end if;
   select * into se from public.training_sessions where club_id=1 and (id=apply_action.id or (date=(patch->>'date')::date and session_no=(patch->>'sessionNo')::integer));
   if found then return jsonb_build_object('status','conflict','code','SESSION_EXISTS','current',se.data,'version',se.version::text);end if;
   new_data=patch||jsonb_build_object('id',id,'version','1','updatedBy',auth.uid(),'serverAt',now_at);
   insert into public.training_sessions values(1,id,(patch->>'date')::date,(patch->>'sessionNo')::integer,new_data,1);
   n=club_private.emit_change('sessions',id,new_data);
   return jsonb_build_object('status','applied','changed',true,'seq',n::text,'version','1','record',new_data,'domain','sessions','serverAt',now_at);
 elsif kind in ('training.set','training.remove') then
   if session_id is not null then
     select * into se from public.training_sessions where club_id=1 and id=session_id;
     if not found then raise exception 'SESSION_NOT_FOUND' using errcode='22023';end if;
     if se.date>(now_at at time zone 'Africa/Blantyre')::date then raise exception 'FUTURE_ATTENDANCE' using errcode='22023';end if;
     select * into tr from public.training_records where club_id=1 and training_records.session_id=apply_action.session_id and player_id=pid for update;
   else
     select * into tr from public.training_records where club_id=1 and training_records.id=apply_action.id for update;
   end if;
   existed=found;
   if existed then
     if tr.deleted then raise exception 'RECORD_DELETED' using errcode='22023';end if;
     id=tr.id;pid=tr.player_id;row_data=defaults||tr.data;current_version=tr.version;
   else
     if session_id is null or not club_private.active_player(pid) or a->>'baseRecordExists' is distinct from 'false' or base<>0 then raise exception 'INVALID_NEW_RECORD' using errcode='22023';end if;
     id=coalesce(id,session_id||'|'||pid);row_data=defaults||jsonb_build_object('id',id,'playerId',pid,'sessionId',session_id,'date',se.date);
   end if;
   if kind='training.remove' then
     if not existed or current_version<>base then return jsonb_build_object('status','conflict','current',row_data,'version',current_version::text);end if;
     new_data=row_data||jsonb_build_object('deleted',true);
   else
     if jsonb_typeof(a->'base')<>'object' then raise exception 'INVALID_BASE' using errcode='22023';end if;
     for field in select jsonb_object_keys(patch) loop
       if field not in ('attendance','minutes','rpe','notes','type') then raise exception 'INVALID_TRAINING_FIELD' using errcode='22023';end if;
       if row_data->field is distinct from (case when a->>'baseRecordExists'='false' then defaults->field else a->'base'->field end) and row_data->field is distinct from patch->field then
         conflicts=conflicts||jsonb_build_object(field,jsonb_build_object('base',a->'base'->field,'current',row_data->field,'proposed',patch->field));
       end if;
     end loop;
     if conflicts<>'{}' then return jsonb_build_object('status','conflict','fields',conflicts,'current',row_data,'version',current_version::text);end if;
     new_data=row_data||patch;
     if new_data->>'attendance' is not null and new_data->>'attendance' not in ('Present','Late','Absent','Excused','Rehab') or jsonb_typeof(new_data->'minutes') is distinct from 'number' or (new_data->>'minutes')::numeric not between 0 and 600 or new_data->>'rpe' is not null and (jsonb_typeof(new_data->'rpe')<>'number' or (new_data->>'rpe')::numeric not between 0 and 10) or jsonb_typeof(new_data->'notes') is distinct from 'string' or length(new_data->>'notes')>10000 or (new_data->>'type' is not null and jsonb_typeof(new_data->'type')<>'string') then raise exception 'INVALID_TRAINING_RECORD' using errcode='22023';end if;
   end if;
   if existed and new_data=row_data then return jsonb_build_object('status','applied','changed',false,'version',current_version::text,'record',tr.data,'domain','training','serverAt',now_at);end if;
   current_version=current_version+1;new_data=new_data||jsonb_build_object('version',current_version::text,'updatedBy',auth.uid(),'serverAt',now_at);
   if existed then update public.training_records set data=new_data,version=current_version,deleted=kind='training.remove' where club_id=1 and training_records.id=apply_action.id;
   else insert into public.training_records values(1,id,session_id,pid,new_data,current_version,false);end if;
   n=club_private.emit_change('training',id,new_data);
 elsif kind like 'allowance.%' and kind<>'allowance.pay' then
   select * into al from public.allowance_records where club_id=1 and allowance_records.id=apply_action.id for update;
   existed=found;row_data=al.data;current_version=coalesce(al.version,0);
   if kind='allowance.add' then
     if existed then raise exception 'RECORD_EXISTS' using errcode='22023';end if;
     new_data=patch;pid=patch->>'playerId';if not club_private.active_player(pid) then raise exception 'PLAYER_NOT_FOUND' using errcode='22023';end if;
   else
     if not existed then raise exception 'RECORD_NOT_FOUND' using errcode='22023';end if;
     if base<>current_version then return jsonb_build_object('status','conflict','current',row_data,'version',current_version::text);end if;
     if kind not in ('allowance.update','allowance.void') then raise exception 'INVALID_KIND' using errcode='22023';end if;
     new_data=row_data||patch;pid=new_data->>'playerId';
     select coalesce(sum(t.amount),0) into paid from public.ledger_transactions t where t.club_id=1 and t.allowance_id=apply_action.id and not coalesce((t.data->>'voided')::boolean,false);
     if paid>0 and (pid<>al.player_id or kind='allowance.void' or coalesce((new_data->>'voided')::boolean,false)) then raise exception 'ALLOWANCE_HAS_PAYMENTS' using errcode='22023';end if;
   end if;
   amount=club_private.money(new_data->'amount');
   if new_data->>'date'!~'^\d{4}-\d{2}-\d{2}$' or (new_data->>'date')::date is null or coalesce(new_data->>'reason','')='' or not club_private.active_player(pid) then raise exception 'INVALID_ALLOWANCE' using errcode='22023';end if;
   if amount<coalesce(paid,0) then raise exception 'ALLOWANCE_BELOW_PAID' using errcode='22023';end if;
   if kind='allowance.void' then new_data=new_data||'{"voided":true}';end if;
   new_data=new_data||jsonb_build_object('id',id,'amount',amount::text,'voided',coalesce((new_data->>'voided')::boolean,false));
   if new_data=row_data then return jsonb_build_object('status','applied','changed',false,'version',current_version::text,'record',row_data,'domain','allowances');end if;
   current_version=current_version+1;new_data=new_data||jsonb_build_object('version',current_version::text,'updatedBy',auth.uid(),'serverAt',now_at);
   if existed then update public.allowance_records set data=new_data,amount=apply_action.amount,player_id=pid,version=current_version where club_id=1 and allowance_records.id=apply_action.id;
   else insert into public.allowance_records values(1,id,pid,amount,new_data,current_version);end if;
   n=club_private.emit_change('allowances',id,new_data);
 elsif kind in ('expense.add','expense.update','expense.void','allowance.pay') then
   linked=patch->>'allowanceId';
   if linked is null then select allowance_id into linked from public.ledger_transactions where club_id=1 and ledger_transactions.id=apply_action.id;end if;
   if linked is not null then
     select * into al from public.allowance_records where club_id=1 and allowance_records.id=linked for update;
     if not found then raise exception 'ALLOWANCE_NOT_FOUND' using errcode='22023';end if;
   end if;
   select * into le from public.ledger_transactions where club_id=1 and ledger_transactions.id=apply_action.id for update;
   existed=found;row_data=le.data;current_version=coalesce(le.version,0);
   if kind in ('expense.add','allowance.pay') then
     if existed then raise exception 'RECORD_EXISTS' using errcode='22023';end if;
     new_data=patch;
     if linked is not null and kind<>'allowance.pay' then raise exception 'ONLINE_PAYMENT_REQUIRED' using errcode='22023';end if;
     if kind='allowance.pay' then
       if linked is null or coalesce((al.data->>'voided')::boolean,false) then raise exception 'ALLOWANCE_NOT_FOUND' using errcode='22023';end if;
       new_data=new_data||jsonb_build_object('allowanceId',linked,'type','expense','category','선수 수당','playerId',al.player_id,'description',al.data->>'reason');
     end if;
   else
     if not existed then raise exception 'RECORD_NOT_FOUND' using errcode='22023';end if;
     if base<>current_version then return jsonb_build_object('status','conflict','current',row_data,'version',current_version::text);end if;
     if le.allowance_id is not null and kind<>'expense.void' then raise exception 'PAYMENT_EDIT_FORBIDDEN' using errcode='22023';end if;
     if patch ? 'allowanceId' then raise exception 'PAYMENT_EDIT_FORBIDDEN' using errcode='22023';end if;
     if coalesce((row_data->>'voided')::boolean,false) then raise exception 'RECORD_VOIDED' using errcode='22023';end if;
     new_data=row_data||patch;
   end if;
   if kind='expense.void' then new_data=new_data||'{"voided":true}';end if;
   amount=club_private.money(new_data->'amount');
   if coalesce(new_data->>'type','') not in ('income','expense') or coalesce(new_data->>'category','')='' or length(new_data->>'category')>200 or coalesce(new_data->>'description','')='' or length(new_data->>'description')>10000 or new_data->>'date'!~'^\d{4}-\d{2}-\d{2}$' or (new_data->>'date')::date is null then raise exception 'INVALID_TRANSACTION' using errcode='22023';end if;
   if coalesce(new_data->>'receiptPath','')<>'' and new_data->>'receiptPath'!~'^receipts/[A-Za-z0-9_-]+/[A-Fa-f0-9-]+\.(webp|jpg|png)$' then raise exception 'INVALID_RECEIPT_PATH' using errcode='22023';end if;
   if coalesce(new_data->>'paymentMethod','cash') not in ('cash','airtel','mpamba','bank','other') then raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023';end if;
   if linked is not null and kind='allowance.pay' then
     select coalesce(sum(t.amount),0) into paid from public.ledger_transactions t where t.club_id=1 and t.allowance_id=linked and not coalesce((t.data->>'voided')::boolean,false);
     if paid+amount>al.amount then raise exception 'PAYMENT_EXCEEDS_OUTSTANDING' using errcode='22023';end if;
   end if;
   new_data=new_data||jsonb_build_object('id',id,'amount',amount::text,'voided',coalesce((new_data->>'voided')::boolean,false));
   if new_data=row_data then return jsonb_build_object('status','applied','changed',false,'version',current_version::text,'record',row_data,'domain','ledger');end if;
   current_version=current_version+1;new_data=new_data||jsonb_build_object('version',current_version::text,'updatedBy',auth.uid(),'serverAt',now_at);
   if existed then update public.ledger_transactions set data=new_data,amount=apply_action.amount,version=current_version where club_id=1 and ledger_transactions.id=apply_action.id;
   else insert into public.ledger_transactions values(1,id,linked,amount,new_data,current_version);end if;
   n=club_private.emit_change('ledger',id,new_data);
 else raise exception 'INVALID_KIND' using errcode='22023';end if;
 return jsonb_build_object('status','applied','changed',true,'seq',n::text,'version',current_version::text,'record',new_data,'domain',case when kind like 'training.%' then 'training' when kind like 'allowance.%' and kind<>'allowance.pay' then 'allowances' else 'ledger' end,'serverAt',now_at);
end $$;

create function public.apply_club_actions(p_actions jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a jsonb; receipt club_private.mutation_receipts; result jsonb; results jsonb:='[]'; mid uuid; h public.sync_heads;
begin
 perform club_private.require_member();
 if jsonb_typeof(p_actions) is distinct from 'array' or jsonb_array_length(p_actions)>50 or octet_length(p_actions::text)>262144 then raise exception 'INVALID_BATCH' using errcode='22023';end if;
 select * into h from public.sync_heads where club_id=1 for update;
 if h.maintenance then raise exception 'MAINTENANCE' using errcode='55000';end if;
 if not h.enabled then raise exception 'SYNC_NOT_ENABLED' using errcode='55000';end if;
 for a in select value from jsonb_array_elements(p_actions) loop
   mid=null;
   begin
     mid=(a->>'mutationId')::uuid;
     if mid is null or a->>'ownerUserId' is distinct from auth.uid()::text then raise exception 'MUTATION_OWNER_MISMATCH' using errcode='22023';end if;
     select * into receipt from club_private.mutation_receipts where mutation_id=mid;
     if found then
       if receipt.owner_id<>auth.uid() or receipt.request<>a then
         result=jsonb_build_object('status','rejected','code','MUTATION_ID_REUSED');
       else
         result=receipt.result;
         if result->>'status'='applied' then result=result||jsonb_build_object('status','duplicate','originalStatus','applied');end if;
       end if;
     else
       begin
         if not exists(select 1 from club_private.schema_support where version::text=a->>'schemaVersion' and (accept_until is null or accept_until>clock_timestamp())) then raise exception 'CLIENT_UPGRADE_REQUIRED' using errcode='22023';end if;
         if a->>'syncEpoch' is distinct from h.sync_epoch::text then raise exception 'SYNC_EPOCH_CHANGED' using errcode='22023';end if;
         result=club_private.apply_action(a);
       exception when sqlstate '22023' or sqlstate '22P02' or sqlstate '22007' or sqlstate '22008' or sqlstate '22003' or sqlstate '23502' or sqlstate '23514' or sqlstate '23505' or sqlstate '23503' then
         result=jsonb_build_object('status','rejected','code',case when sqlerrm~'^[A-Z_]+$' then sqlerrm else 'INVALID_ACTION' end);
       end;
       result=result||jsonb_build_object('mutationId',mid,'syncEpoch',h.sync_epoch);
       insert into club_private.mutation_receipts values(mid,auth.uid(),a,result,clock_timestamp());
     end if;
   exception when sqlstate '22023' or sqlstate '22P02' then
     result=jsonb_build_object('status','rejected','code',case when sqlerrm~'^[A-Z_]+$' then sqlerrm else 'INVALID_ACTION' end);
   end;
   results=results||jsonb_build_array(result||jsonb_build_object('mutationId',a->>'mutationId'));
 end loop;
 return jsonb_build_object('results',results,'syncEpoch',h.sync_epoch);
end $$;

create function public.get_club_snapshot() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare h public.sync_heads; c public.club_state; result jsonb;
begin
 perform club_private.require_member();select * into h from public.sync_heads where club_id=1 for share;
 if h.maintenance then raise exception 'MAINTENANCE' using errcode='55000';end if;
 select * into c from public.club_state where id=1;
 select jsonb_build_object('enabled',h.enabled,'syncEpoch',h.sync_epoch,'cursor',h.seq::text,'revision',c.revision,'savedAt',c.saved_at,'state',c.state,
  'sessions',coalesce((select jsonb_agg(data) from public.training_sessions where club_id=1),'[]'),
  'training',coalesce((select jsonb_agg(data) from public.training_records where club_id=1 and not deleted),'[]'),
  'ledger',coalesce((select jsonb_agg(data) from public.ledger_transactions where club_id=1),'[]'),
  'allowances',coalesce((select jsonb_agg(data) from public.allowance_records where club_id=1),'[]'),
  'medical',coalesce((select jsonb_agg(jsonb_build_object('playerId',m.player_id,'data',m.data,'version',m.version::text)) from public.player_medical m where club_id=1),'[]'),
  'medicalRevision',h.medical_revision::text,'serverAt',clock_timestamp()) into result;
 return result;
end $$;
create function public.pull_club_changes(p_after_seq text,p_sync_epoch uuid,p_page_size integer default 100) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare h public.sync_heads; changes jsonb; next_cursor bigint;
begin
 perform club_private.require_member();select * into h from public.sync_heads where club_id=1 for share;
 if h.maintenance then raise exception 'MAINTENANCE' using errcode='55000';end if;
 if h.sync_epoch<>p_sync_epoch or (p_after_seq)::bigint>h.seq then raise exception 'SYNC_EPOCH_CHANGED' using errcode='22023';end if;
 if (p_after_seq)::bigint<0 then raise exception 'INVALID_CURSOR' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('seq',seq::text,'domain',domain,'recordId',record_id,'record',record) order by seq),'[]'),coalesce(max(seq),p_after_seq::bigint)
 into changes,next_cursor from (select * from public.change_log where club_id=1 and seq>p_after_seq::bigint order by seq limit greatest(1,least(coalesce(p_page_size,100),200))) page;
 return jsonb_build_object('changes',changes,'nextCursor',next_cursor::text,'hasMore',next_cursor<h.seq,'latestSeq',h.seq::text,'syncEpoch',h.sync_epoch);
end $$;

-- Keep the old save endpoint for profiles/plans; reject migrated fields instead of reporting false success.
alter function public.save_club_state(jsonb,bigint,uuid) rename to legacy_save_club_state;
revoke all on function public.legacy_save_club_state(jsonb,bigint,uuid) from public,anon,authenticated;
create function public.save_club_state(p_state jsonb,p_base_revision bigint,p_mutation_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare h public.sync_heads; result jsonb;
begin
 perform club_private.require_member();select * into h from public.sync_heads where club_id=1 for update;
 if h.maintenance then raise exception 'MAINTENANCE' using errcode='55000';end if;
 if h.enabled and (p_state#>>'{meta,syncFormat}' is distinct from '1' or p_state->'training' is distinct from '[]'::jsonb or coalesce(p_state#>'{operations,finance,transactions}','[]')<>'[]' or coalesce(p_state#>'{operations,finance,allowances}','[]')<>'[]') then raise exception 'CLIENT_UPGRADE_REQUIRED' using errcode='22023';end if;
 result=public.legacy_save_club_state(p_state,p_base_revision,p_mutation_id);return result;
end $$;

-- Operational activation is a separate, explicit step after all devices have uploaded.
create function public.admin_sync_maintenance(p_enabled boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 perform club_private.require_member();if not club_private.is_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
 perform 1 from public.sync_heads where club_id=1 for update;
 update public.sync_heads set maintenance=p_enabled where club_id=1;
 return jsonb_build_object('maintenance',p_enabled);
end $$;
create function club_private.import_domains(s jsonb) returns void language plpgsql set search_path='' as $$
declare r jsonb; d date; sid text;
begin
 for r in select value from jsonb_array_elements(coalesce(s#>'{operations,finance,allowances}','[]')) loop
   insert into public.allowance_records values(1,r->>'id',r->>'playerId',(r->>'amount')::numeric(18,2),r||jsonb_build_object('amount',((r->>'amount')::numeric(18,2))::text,'version','1'),1);
 end loop;
 for r in select value from jsonb_array_elements(coalesce(s#>'{operations,finance,transactions}','[]')) loop
   insert into public.ledger_transactions values(1,r->>'id',nullif(r->>'allowanceId',''),(r->>'amount')::numeric(18,2),r||jsonb_build_object('amount',((r->>'amount')::numeric(18,2))::text,'version','1','paymentMethod',coalesce(r->>'paymentMethod','cash')),1);
 end loop;
 if exists(select 1 from public.allowance_records a where a.club_id=1 and a.amount<(select coalesce(sum(l.amount),0) from public.ledger_transactions l where l.club_id=1 and l.allowance_id=a.id and not coalesce((l.data->>'voided')::boolean,false))) then raise exception 'ALLOWANCE_OVERPAID' using errcode='22023';end if;
 if exists(select 1 from public.ledger_transactions l join public.allowance_records a on a.club_id=l.club_id and a.id=l.allowance_id where not coalesce((l.data->>'voided')::boolean,false) and (l.data->>'type'<>'expense' or coalesce((a.data->>'voided')::boolean,false))) then raise exception 'INVALID_PAYMENT' using errcode='22023';end if;
 for d in select distinct (value->>'date')::date from jsonb_array_elements(s->'training') loop
   sid='legacy-'||d::text||'#1';
   insert into public.training_sessions values(1,sid,d,1,jsonb_build_object('id',sid,'date',d,'sessionNo',1,'name','기존 훈련','version','1'),1);
 end loop;
 for r in select value from jsonb_array_elements(s->'training') loop
   select case when count(*)=1 then 'legacy-'||(r->>'date')||'#1' else null end into sid from jsonb_array_elements(s->'training') x where x->>'date'=r->>'date' and x->>'playerId'=r->>'playerId';
   insert into public.training_records values(1,r->>'id',sid,r->>'playerId',r||jsonb_build_object('sessionId',sid,'rpe',case when r->>'rpe'='' then 'null'::jsonb else r->'rpe' end,'version','1'),1,false);
 end loop;
end $$;
create function club_private.strip_domains(s jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
begin
 s=jsonb_set(s,'{training}','[]');
 if s ? 'operations' then s=jsonb_set(s,'{operations,finance,transactions}','[]');s=jsonb_set(s,'{operations,finance,allowances}','[]');end if;
 return jsonb_set(s,'{meta,syncFormat}','1');
end $$;
create function public.admin_activate_offline(p_expected_revision bigint,p_archive_owner uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare h public.sync_heads; c public.club_state;
begin
 perform club_private.require_member();if not club_private.is_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
 select * into h from public.sync_heads where club_id=1 for update;
 if h.enabled and h.migrated_revision=p_expected_revision and exists(select 1 from club_private.medical_archive_access where user_id=p_archive_owner and is_owner) then return public.get_club_snapshot();end if;
 if not h.maintenance or h.enabled then raise exception 'CUTOVER_NOT_READY' using errcode='22023';end if;
 select * into c from public.club_state where id=1 for update;
 if c.revision<>p_expected_revision then raise exception 'SAVE_CONFLICT' using errcode='40001';end if;
 if not exists(select 1 from public.club_members where id=p_archive_owner and status='active') then raise exception 'ARCHIVE_OWNER_REQUIRED' using errcode='22023';end if;
 insert into club_private.cutover_backups values(1,h.sync_epoch,c.revision,c.state,clock_timestamp());
 perform club_private.validate_domain_import(c.state,'[]');
 perform club_private.import_domains(c.state);
 insert into club_private.medical_archive_access(user_id,is_owner,granted_by) values(p_archive_owner,true,auth.uid());
 update public.club_state set state=club_private.strip_domains(state),revision=revision+1,saved_at=clock_timestamp() where id=1;
 update public.sync_heads set enabled=true,migrated_revision=c.revision,maintenance=false where club_id=1;
 return public.get_club_snapshot();
end $$;

create function public.save_player_medical(p_player_id text,p_data jsonb,p_base_version text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare h public.sync_heads; m public.player_medical; new_version bigint; field text;
begin
 perform club_private.require_member();select * into h from public.sync_heads where club_id=1 for update;
 if h.maintenance or not h.enabled then raise exception 'MAINTENANCE' using errcode='55000';end if;
 if not club_private.active_player(p_player_id) then raise exception 'PLAYER_NOT_ACTIVE' using errcode='22023';end if;
 if jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>8000 then raise exception 'INVALID_MEDICAL' using errcode='22023';end if;
 for field in select jsonb_object_keys(p_data) loop
   if field not in ('contactName','contactRelationship','contactPhone','allergyStatus','allergyNote','source','confirmedAt','consent','consentAt') then raise exception 'INVALID_MEDICAL_FIELD' using errcode='22023';end if;
   if length(coalesce(p_data->>field,''))>2000 then raise exception 'INVALID_MEDICAL' using errcode='22023';end if;
 end loop;
 if p_data->>'allergyStatus' not in ('unknown','none','known') or p_data->>'consent' is distinct from 'true' then raise exception 'MEDICAL_CONSENT_REQUIRED' using errcode='22023';end if;
 if p_data->>'allergyStatus'='known' and coalesce(p_data->>'allergyNote','')='' or coalesce(p_data->>'source','')='' or (p_data->>'confirmedAt')::date is null or (p_data->>'consentAt')::date is null then raise exception 'INVALID_MEDICAL' using errcode='22023';end if;
 select * into m from public.player_medical where club_id=1 and player_id=p_player_id for update;
 if coalesce(m.version,0)<>p_base_version::bigint then raise exception 'MEDICAL_CONFLICT' using errcode='40001';end if;
 new_version=coalesce(m.version,0)+1;
 insert into public.player_medical values(1,p_player_id,p_data,new_version,auth.uid(),clock_timestamp()) on conflict(club_id,player_id) do update set data=excluded.data,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 update public.sync_heads set medical_revision=medical_revision+1 where club_id=1;
 return jsonb_build_object('playerId',p_player_id,'data',p_data,'version',new_version::text);
end $$;
create function public.medical_archive_grant(p_user_id uuid,p_allowed boolean) returns void language plpgsql volatile security definer set search_path='' as $$
begin
 perform club_private.require_member();perform 1 from public.sync_heads where club_id=1 for update;
 if not exists(select 1 from club_private.medical_archive_access where user_id=auth.uid() and is_owner) then raise exception 'ARCHIVE_OWNER_REQUIRED' using errcode='42501';end if;
 if exists(select 1 from club_private.medical_archive_access where user_id=p_user_id and is_owner) then raise exception 'ARCHIVE_OWNER_PROTECTED' using errcode='22023';end if;
 if p_allowed then
   if not exists(select 1 from public.club_members where id=p_user_id and status='active') then raise exception 'ACTIVE_MEMBER_REQUIRED' using errcode='22023';end if;
   insert into club_private.medical_archive_access(user_id,granted_by) values(p_user_id,auth.uid()) on conflict(user_id) do nothing;
 else delete from club_private.medical_archive_access where user_id=p_user_id and not is_owner;end if;
end $$;
create function club_private.archive_departed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.player_medical_archive(club_id,player_id,data,archived_by)
 select m.club_id,m.player_id,m.data,auth.uid() from public.player_medical m where m.club_id=1 and not exists(select 1 from jsonb_array_elements(new.state->'players') p where p->>'id'=m.player_id and p->>'status'='Active');
 delete from public.player_medical m where m.club_id=1 and not exists(select 1 from jsonb_array_elements(new.state->'players') p where p->>'id'=m.player_id and p->>'status'='Active');
 if found then update public.sync_heads set medical_revision=medical_revision+1 where club_id=1;end if;
 return new;
end $$;
create trigger archive_departed before update of state on public.club_state for each row execute function club_private.archive_departed();

-- Private helpers never have an exposed execution grant.
revoke all on all functions in schema club_private from public,anon;
revoke all on function club_private.require_member(),club_private.emit_change(text,text,jsonb),club_private.money(jsonb),club_private.active_player(text),club_private.training_defaults(),club_private.apply_action(jsonb),club_private.import_domains(jsonb),club_private.strip_domains(jsonb),club_private.archive_departed() from authenticated;
revoke all on function public.apply_club_actions(jsonb),public.get_club_snapshot(),public.pull_club_changes(text,uuid,integer),public.save_club_state(jsonb,bigint,uuid),public.admin_sync_maintenance(boolean),public.admin_activate_offline(bigint,uuid),public.save_player_medical(text,jsonb,text),public.medical_archive_grant(uuid,boolean) from public,anon;
grant execute on function public.apply_club_actions(jsonb),public.get_club_snapshot(),public.pull_club_changes(text,uuid,integer),public.save_club_state(jsonb,bigint,uuid),public.admin_sync_maintenance(boolean),public.admin_activate_offline(bigint,uuid),public.save_player_medical(text,jsonb,text),public.medical_archive_grant(uuid,boolean) to authenticated;
commit;
