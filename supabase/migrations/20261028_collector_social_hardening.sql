-- Browser clients may supply only author/target/body fields. Server-owned
-- timestamps and moderation state must not be forgeable via direct API calls.
begin;

create or replace function public.limit_collector_gallery_comments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.author_user_id::text, 0));
  new.created_at := now();
  if exists (
    select 1 from public.collector_gallery_comments
    where author_user_id = new.author_user_id
      and created_at > now() - interval '20 seconds'
  ) then
    raise exception 'Please wait a little before commenting again.';
  end if;
  return new;
end;
$$;

revoke insert on public.collector_gallery_comments from authenticated;
grant insert (profile_user_id, author_user_id, body)
  on public.collector_gallery_comments to authenticated;

revoke insert on public.collector_gallery_comment_reports from authenticated;
grant insert (comment_id, reporter_user_id, reason)
  on public.collector_gallery_comment_reports to authenticated;

commit;
