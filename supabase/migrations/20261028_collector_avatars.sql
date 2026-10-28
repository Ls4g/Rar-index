-- Collector profile photos are intentionally public, like published shelves.
-- Uploads are restricted to one small JPEG per authenticated owner.
begin;

alter table public.collector_profiles
  add column if not exists avatar_updated_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('collector-avatars', 'collector-avatars', true, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy "Owners can inspect their avatar file"
  on storage.objects for select to authenticated
  using (bucket_id = 'collector-avatars' and name = auth.uid()::text || '/avatar.jpg');
create policy "Owners can upload their avatar file"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'collector-avatars' and name = auth.uid()::text || '/avatar.jpg');
create policy "Owners can replace their avatar file"
  on storage.objects for update to authenticated
  using (bucket_id = 'collector-avatars' and name = auth.uid()::text || '/avatar.jpg')
  with check (bucket_id = 'collector-avatars' and name = auth.uid()::text || '/avatar.jpg');
create policy "Owners can remove their avatar file"
  on storage.objects for delete to authenticated
  using (bucket_id = 'collector-avatars' and name = auth.uid()::text || '/avatar.jpg');

commit;
