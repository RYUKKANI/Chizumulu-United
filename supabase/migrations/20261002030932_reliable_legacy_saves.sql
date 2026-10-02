begin;
alter table club_private.save_receipts add column request_state jsonb, add column base_revision bigint;
create or replace function public.save_club_state(p_state jsonb,p_base_revision bigint,p_mutation_id uuid)
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
    if receipt.request_state is not null and (receipt.request_state<>p_state or receipt.base_revision<>p_base_revision) then raise exception 'MUTATION_ID_REUSED' using errcode='22023'; end if;
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
  insert into club_private.save_receipts(mutation_id,member_id,revision,saved_at,request_state,base_revision) values(p_mutation_id,auth.uid(),current_row.revision,next_time,p_state,p_base_revision);
  return jsonb_build_object('revision',current_row.revision,'savedAt',next_time,'mutationId',p_mutation_id);
end;
$$;
revoke all on function public.save_club_state(jsonb,bigint,uuid) from public, anon;
grant execute on function public.save_club_state(jsonb,bigint,uuid) to authenticated;

commit;
