begin;
create table club_private.schema_support (
 version integer primary key, announced_at timestamptz, accept_until timestamptz,
 check(accept_until is null or announced_at is not null and accept_until>=announced_at+interval '14 days')
);
insert into club_private.schema_support(version) values(1);
alter table club_private.schema_support enable row level security;
revoke all on club_private.schema_support from public,anon,authenticated;

create function public.inspect_legacy_draft(p_draft jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare h public.sync_heads; r club_private.save_receipts; b club_private.cutover_backups;
begin
 perform club_private.require_member();select * into h from public.sync_heads where club_id=1 for share;
 select * into r from club_private.save_receipts where mutation_id=(p_draft->>'mutationId')::uuid;
 if found then
  if r.member_id<>auth.uid() then raise exception 'MUTATION_OWNER_MISMATCH' using errcode='42501';end if;
  if r.request_state is not null and (r.request_state<>p_draft->'state' or r.base_revision<>(p_draft->>'baseRevision')::bigint) then raise exception 'MUTATION_ID_REUSED' using errcode='22023';end if;
  return jsonb_build_object('status','already_applied','revision',r.revision);
 end if;
 select * into b from club_private.cutover_backups where club_id=1 and sync_epoch=h.sync_epoch;
 if not found or b.revision<>(p_draft->>'baseRevision')::bigint then return jsonb_build_object('status','review_required');end if;
 return jsonb_build_object('status','convertible','baseline',b.state,'cutoverRevision',b.revision);
end $$;

create function public.admin_restore_club(p_state jsonb,p_sessions jsonb,p_expected_revision bigint,p_mutation_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare h public.sync_heads; c public.club_state; receipt club_private.mutation_receipts; req jsonb; result jsonb; s jsonb; r jsonb;
begin
 perform club_private.require_member();if not club_private.is_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
 select * into h from public.sync_heads where club_id=1 for update;
 req=jsonb_build_object('state',p_state,'sessions',p_sessions,'expectedRevision',p_expected_revision);
 select * into receipt from club_private.mutation_receipts where mutation_id=p_mutation_id;
 if found then
  if receipt.owner_id<>auth.uid() or receipt.request<>req then raise exception 'MUTATION_ID_REUSED' using errcode='22023';end if;
  return receipt.result;
 end if;
 if h.maintenance or not h.enabled then raise exception 'MAINTENANCE' using errcode='55000';end if;
 select * into c from public.club_state where id=1 for update;
 if c.revision<>p_expected_revision then raise exception 'SAVE_CONFLICT' using errcode='40001';end if;
 if jsonb_typeof(p_sessions) is distinct from 'array' or jsonb_array_length(p_sessions)>5000 then raise exception 'INVALID_SESSIONS' using errcode='22023';end if;
 perform club_private.validate_domain_import(p_state,p_sessions);
 -- Use the existing state shape/size validation; all migrated domains are imported atomically below.
 perform public.legacy_save_club_state(club_private.strip_domains(p_state),p_expected_revision,p_mutation_id);
 delete from public.change_log where club_id=1;
 delete from public.ledger_transactions where club_id=1;
 delete from public.allowance_records where club_id=1;
 delete from public.training_records where club_id=1;
 delete from public.training_sessions where club_id=1;
 if jsonb_array_length(p_sessions)=0 then
  perform club_private.import_domains(p_state);
 else
  s=jsonb_set(p_state,'{training}','[]');perform club_private.import_domains(s);
  for r in select value from jsonb_array_elements(p_sessions) loop
   insert into public.training_sessions values(1,r->>'id',(r->>'date')::date,(r->>'sessionNo')::integer,r||jsonb_build_object('version','1'),1);
  end loop;
  for r in select value from jsonb_array_elements(p_state->'training') loop
   insert into public.training_records values(1,r->>'id',nullif(r->>'sessionId',''),r->>'playerId',r||jsonb_build_object('version','1','rpe',case when r->>'rpe'='' then 'null'::jsonb else r->'rpe' end),1,false);
  end loop;
 end if;
 update public.sync_heads set sync_epoch=gen_random_uuid(),seq=0 where club_id=1;
 select * into h from public.sync_heads where club_id=1;
 result=jsonb_build_object('status','applied','syncEpoch',h.sync_epoch,'revision',p_expected_revision+1);
 insert into club_private.mutation_receipts values(p_mutation_id,auth.uid(),req,result,clock_timestamp());
 return result;
end $$;
revoke all on function public.inspect_legacy_draft(jsonb),public.admin_restore_club(jsonb,jsonb,bigint,uuid) from public,anon;
grant execute on function public.inspect_legacy_draft(jsonb),public.admin_restore_club(jsonb,jsonb,bigint,uuid) to authenticated;
commit;
