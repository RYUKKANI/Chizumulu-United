-- Run once in the project's SQL Editor, after your administrator signs up.
-- Replace only this address with the email of the intended administrator.
do $$
declare administrator_email text := 'REPLACE_WITH_ADMIN_EMAIL'; administrator_id uuid;
begin
  perform pg_advisory_xact_lock(20261001,1);
  if administrator_email='REPLACE_WITH_ADMIN_EMAIL' then raise exception 'Set the administrator email first'; end if;
  if exists(select 1 from public.club_members where role='admin' and status='active') then
    raise exception 'An administrator already exists. Use the site member management page instead.';
  end if;
  select id into strict administrator_id from auth.users where lower(email)=lower(administrator_email);
  update public.club_members set role='admin',status='active',updated_at=now() where id=administrator_id;
  if not found then raise exception 'The administrator must sign up on the site first'; end if;
end;
$$;
