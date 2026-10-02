begin;
create function club_private.validate_domain_import(s jsonb,sessions jsonb) returns void language plpgsql set search_path='' as $$
declare rows jsonb; r jsonb; domain text;
begin
 if octet_length(s::text)>20971520 then raise exception 'BACKUP_TOO_LARGE' using errcode='22023';end if;
 foreach domain in array array['training','transactions','allowances'] loop
  rows=case when domain='training' then s->'training' else coalesce(s#>array['operations','finance',domain],'[]') end;
  if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)>50000 then raise exception 'INVALID_DOMAIN_IMPORT' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(rows) x group by x->>'id' having count(*)>1) then raise exception 'DUPLICATE_RECORD_ID' using errcode='22023';end if;
  for r in select value from jsonb_array_elements(rows) loop
   if jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'id') is distinct from 'string' or length(r->>'id') not between 1 and 160 or coalesce(r->>'date','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_DOMAIN_IMPORT' using errcode='22023';end if;
   perform (r->>'date')::date;
   if domain='training' then
    if jsonb_typeof(r->'playerId') is distinct from 'string' or coalesce(r->>'playerId','')='' or jsonb_typeof(r->'minutes') is distinct from 'number' or (r->>'minutes')::numeric<0 or coalesce(r->>'attendance','') not in ('','Present','Late','Absent','Excused','Rehab') or r->>'rpe' not in ('','') and (jsonb_typeof(r->'rpe') is distinct from 'number' or (r->>'rpe')::numeric not between 0 and 10) or r ? 'notes' and jsonb_typeof(r->'notes') is distinct from 'string' then raise exception 'INVALID_TRAINING_IMPORT' using errcode='22023';end if;
    if jsonb_array_length(sessions)>0 and nullif(r->>'sessionId','') is not null and not exists(select 1 from jsonb_array_elements(sessions) x where x->>'id'=r->>'sessionId' and x->>'date'=r->>'date') then raise exception 'INVALID_SESSION_LINK' using errcode='22023';end if;
   else
    if coalesce(r->>'amount','')!~'^[0-9]{1,12}(\.[0-9]{1,2})?$' or (r->>'amount')::numeric<=0 or (r->>'amount')::numeric>=1000000000000 or jsonb_typeof(r->'voided') is distinct from 'boolean' then raise exception 'INVALID_FINANCE_IMPORT' using errcode='22023';end if;
    if domain='transactions' and coalesce(r->>'type','') not in ('income','expense') then raise exception 'INVALID_FINANCE_IMPORT' using errcode='22023';end if;
   end if;
  end loop;
 end loop;
end $$;
revoke all on function club_private.validate_domain_import(jsonb,jsonb) from public,anon,authenticated;
-- Independent online medical edits are safe to retry after a lost reply.
create or replace function public.save_player_medical(p_player_id text,p_data jsonb,p_base_version text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare h public.sync_heads; m public.player_medical; new_version bigint; field text;
begin
 perform club_private.require_member();select * into h from public.sync_heads where club_id=1 for update;
 if h.maintenance or not h.enabled then raise exception 'MAINTENANCE' using errcode='55000';end if;
 if not club_private.active_player(p_player_id) then raise exception 'PLAYER_NOT_ACTIVE' using errcode='22023';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>8000 then raise exception 'INVALID_MEDICAL' using errcode='22023';end if;
 for field in select jsonb_object_keys(p_data) loop
  if field not in ('contactName','contactRelationship','contactPhone','allergyStatus','allergyNote','source','confirmedAt','consent','consentAt') then raise exception 'INVALID_MEDICAL_FIELD' using errcode='22023';end if;
  if field='consent' then
   if p_data->field is distinct from 'true'::jsonb then raise exception 'MEDICAL_CONSENT_REQUIRED' using errcode='22023';end if;
  elsif jsonb_typeof(p_data->field) is distinct from 'string' or length(p_data->>field)>2000 then raise exception 'INVALID_MEDICAL' using errcode='22023';end if;
 end loop;
 if coalesce(p_data->>'allergyStatus','') not in ('unknown','none','known') or p_data->'consent' is distinct from 'true'::jsonb then raise exception 'MEDICAL_CONSENT_REQUIRED' using errcode='22023';end if;
 if p_data->>'allergyStatus'='known' and coalesce(p_data->>'allergyNote','')='' or coalesce(p_data->>'source','')='' or coalesce(p_data->>'confirmedAt','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(p_data->>'consentAt','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_MEDICAL' using errcode='22023';end if;
 if (p_data->>'confirmedAt')::date>(current_timestamp at time zone 'Africa/Blantyre')::date or (p_data->>'consentAt')::date>(current_timestamp at time zone 'Africa/Blantyre')::date then raise exception 'INVALID_MEDICAL_DATE' using errcode='22023';end if;
 select * into m from public.player_medical where club_id=1 and player_id=p_player_id for update;
 if found and m.data=p_data then return jsonb_build_object('playerId',p_player_id,'data',m.data,'version',m.version::text,'changed',false);end if;
 if coalesce(m.version,0)<>p_base_version::bigint then raise exception 'MEDICAL_CONFLICT' using errcode='40001';end if;
 new_version=coalesce(m.version,0)+1;
 insert into public.player_medical values(1,p_player_id,p_data,new_version,auth.uid(),clock_timestamp()) on conflict(club_id,player_id) do update set data=excluded.data,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 update public.sync_heads set medical_revision=medical_revision+1 where club_id=1;
 return jsonb_build_object('playerId',p_player_id,'data',p_data,'version',new_version::text,'changed',true);
end $$;
create function public.list_medical_archive_access() returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 perform club_private.require_member();perform 1 from public.sync_heads where club_id=1 for share;
 if not exists(select 1 from club_private.medical_archive_access where user_id=auth.uid() and is_owner) then raise exception 'ARCHIVE_OWNER_REQUIRED' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.display_name,'email',m.email,'allowed',a.user_id is not null,'owner',coalesce(a.is_owner,false)) order by m.display_name) from public.club_members m left join club_private.medical_archive_access a on a.user_id=m.id where m.status='active'),'[]');
end $$;
revoke all on function public.list_medical_archive_access() from public,anon;
grant execute on function public.list_medical_archive_access() to authenticated;
commit;
