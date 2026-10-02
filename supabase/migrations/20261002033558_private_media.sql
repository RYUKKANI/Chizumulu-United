begin;
-- The plain PostgreSQL test fixture has no Storage schema. Hosted Supabase does.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('club-media','club-media',false,61440,array['image/webp','image/jpeg','image/png']) on conflict(id) do nothing;
  execute 'create policy club_media_read on storage.objects for select to authenticated using (bucket_id=''club-media'' and (select club_private.is_active_member()))';
  execute 'create policy club_media_insert on storage.objects for insert to authenticated with check (bucket_id=''club-media'' and name ~ ''^(players|receipts)/[A-Za-z0-9_-]+/[A-Fa-f0-9-]+\.(webp|jpg|png)$'' and (select club_private.is_active_member()))';
 end if;
end $$;
commit;
