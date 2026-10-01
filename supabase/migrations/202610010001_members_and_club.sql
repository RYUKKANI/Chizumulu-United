begin;
create schema if not exists club_private;
revoke all on schema club_private from public, anon;
grant usage on schema club_private to authenticated;

create table public.club_members (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role text not null default 'member' check (role in ('member','admin')),
  status text not null default 'pending' check (status in ('pending','active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.club_member_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  member_id uuid references auth.users(id) on delete set null,
  old_role text, new_role text, old_status text, new_status text,
  changed_at timestamptz not null default now()
);
create table public.club_state (
  id integer primary key check (id = 1),
  state jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  saved_at timestamptz not null default now(),
  last_mutation_id uuid,
  updated_by uuid references auth.users(id) on delete set null,
  check (jsonb_typeof(state) = 'object'),
  check (octet_length(state::text) <= 8388608)
);
create table club_private.save_receipts (
  mutation_id uuid primary key,
  member_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null,
  saved_at timestamptz not null
);
alter table public.club_members enable row level security;
alter table public.club_member_audit enable row level security;
alter table public.club_state enable row level security;
alter table club_private.save_receipts enable row level security;
revoke all on public.club_members, public.club_member_audit, public.club_state from anon, authenticated;
revoke all on club_private.save_receipts from public, anon, authenticated;
grant select on public.club_members, public.club_member_audit, public.club_state to authenticated;

create function club_private.is_active_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.club_members where id = auth.uid() and status = 'active');
$$;
create function club_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.club_members where id = auth.uid() and role = 'admin' and status = 'active');
$$;
revoke all on function club_private.is_active_member(), club_private.is_admin() from public, anon;
grant execute on function club_private.is_active_member(), club_private.is_admin() to authenticated;
create policy member_read on public.club_members for select to authenticated
  using (id = (select auth.uid()) or (select club_private.is_admin()));
create policy member_audit_read on public.club_member_audit for select to authenticated
  using ((select club_private.is_admin()));
create policy state_read on public.club_state for select to authenticated
  using ((select club_private.is_active_member()));

create function club_private.register_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.club_members(id,email,display_name)
  values(new.id,coalesce(new.email,''),coalesce(nullif(left(btrim(new.raw_user_meta_data->>'display_name'),80),''),'회원'));
  return new;
end;
$$;
revoke all on function club_private.register_member() from public, anon, authenticated;
create trigger club_member_signup after insert on auth.users for each row execute function club_private.register_member();

create function club_private.sync_member_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.club_members set email=coalesce(new.email,''), updated_at=now() where id=new.id;
  return new;
end;
$$;
revoke all on function club_private.sync_member_email() from public, anon, authenticated;
create trigger club_member_email after update of email on auth.users for each row execute function club_private.sync_member_email();

create function public.admin_update_club_member(p_member_id uuid,p_role text,p_status text)
returns public.club_members language plpgsql security definer set search_path = '' as $$
declare old_member public.club_members; changed public.club_members;
begin
  -- Serialize all membership decisions, including two admins demoting each other.
  perform pg_advisory_xact_lock(20261001,1);
  if not club_private.is_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_role not in ('member','admin') or p_status not in ('pending','active','disabled')
     or p_role is null or p_status is null then
    raise exception 'INVALID_MEMBER_SETTINGS' using errcode='22023';
  end if;
  select * into old_member from public.club_members where id=p_member_id for update;
  if not found then raise exception 'MEMBER_NOT_FOUND' using errcode='P0002'; end if;
  if old_member.role='admin' and old_member.status='active' and (p_role<>'admin' or p_status<>'active')
     and not exists(select 1 from public.club_members where id<>p_member_id and role='admin' and status='active') then
    raise exception 'LAST_ADMIN_REQUIRED' using errcode='23514';
  end if;
  if old_member.role=p_role and old_member.status=p_status then return old_member; end if;
  update public.club_members set role=p_role,status=p_status,updated_at=now()
    where id=p_member_id returning * into changed;
  insert into public.club_member_audit(actor_id,member_id,old_role,new_role,old_status,new_status)
    values(auth.uid(),p_member_id,old_member.role,p_role,old_member.status,p_status);
  return changed;
end;
$$;
revoke all on function public.admin_update_club_member(uuid,text,text) from public, anon;
grant execute on function public.admin_update_club_member(uuid,text,text) to authenticated;

create function public.save_club_state(p_state jsonb,p_base_revision bigint,p_mutation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_row public.club_state; receipt club_private.save_receipts; next_time timestamptz; field text;
begin
  perform 1 from public.club_members where id=auth.uid() and status='active' for share;
  if not found then raise exception 'ACTIVE_MEMBER_REQUIRED' using errcode='42501'; end if;
  if p_state is null or p_base_revision is null or p_mutation_id is null then
    raise exception 'INVALID_SAVE_REQUEST' using errcode='22023';
  end if;
  select * into current_row from public.club_state where id=1 for update;
  if not found then raise exception 'CLUB_NOT_INITIALIZED' using errcode='P0002'; end if;
  select * into receipt from club_private.save_receipts where mutation_id=p_mutation_id;
  if found then
    if receipt.member_id<>auth.uid() then raise exception 'MUTATION_OWNER_MISMATCH' using errcode='42501'; end if;
    if receipt.revision<>current_row.revision then raise exception 'SAVE_CONFLICT' using errcode='40001'; end if;
    return jsonb_build_object('revision',receipt.revision,'savedAt',receipt.saved_at,'mutationId',p_mutation_id);
  end if;
  if current_row.revision<>p_base_revision then raise exception 'SAVE_CONFLICT' using errcode='40001'; end if;
  if jsonb_typeof(p_state) is distinct from 'object' or jsonb_typeof(p_state->'meta') is distinct from 'object'
     or jsonb_typeof(p_state->'lineups') is distinct from 'object' or jsonb_typeof(p_state->'settings') is distinct from 'object'
     or p_state->>'version' is distinct from '1' or p_state#>>'{meta,season}' is distinct from '2026/27'
     or jsonb_typeof(p_state#>'{meta,source}') is distinct from 'string'
     or jsonb_typeof(p_state#>'{meta,savedAt}') is distinct from 'string' then raise exception 'INVALID_CLUB_STATE' using errcode='22023'; end if;
  foreach field in array array['players','baseStats','fixtures','awards','moves','matchLogs','training','documents','equipment','issues','trips','travelMembers','sponsors','contacts','leagues','competitions','teams','venues','staff','staffHistory'] loop
    if jsonb_typeof(p_state->field) is distinct from 'array' then raise exception 'INVALID_CLUB_STATE' using errcode='22023'; end if;
  end loop;
  if octet_length(p_state::text)>8388608 then raise exception 'CLUB_STATE_TOO_LARGE' using errcode='22023'; end if;
  next_time=clock_timestamp();
  update public.club_state set state=jsonb_set(p_state,'{meta,savedAt}',to_jsonb(next_time)),
    revision=revision+1,saved_at=next_time,last_mutation_id=p_mutation_id,updated_by=auth.uid()
    where id=1 returning * into current_row;
  insert into club_private.save_receipts values(p_mutation_id,auth.uid(),current_row.revision,next_time);
  return jsonb_build_object('revision',current_row.revision,'savedAt',next_time,'mutationId',p_mutation_id);
end;
$$;
revoke all on function public.save_club_state(jsonb,bigint,uuid) from public, anon;
grant execute on function public.save_club_state(jsonb,bigint,uuid) to authenticated;

insert into public.club_state(id,state) values(1,'{"version":1,"meta":{"club":"Chizumulu United FC","season":"2026/27","source":"Club shared database","savedAt":"2026-10-01T00:00:00Z","language":"ko"},"players":[],"baseStats":[],"fixtures":[],"awards":[],"moves":[],"matchLogs":[],"training":[],"documents":[],"equipment":[],"issues":[],"trips":[],"travelMembers":[],"sponsors":[],"contacts":[],"lineups":{},"leagues":[],"competitions":[],"teams":[],"venues":[],"staff":[],"staffHistory":[],"settings":{}}');
commit;
