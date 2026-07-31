-- Cover art is catalogue metadata, not marketplace sale evidence.
alter table public.manga_editions
  add column if not exists cover_source_url text,
  add column if not exists cover_source_name text,
  add column if not exists cover_verification_status text not null default 'missing',
  add column if not exists cover_verified_at timestamptz;

alter table public.manga_editions drop constraint if exists manga_editions_cover_verification_status_check;
alter table public.manga_editions
  add constraint manga_editions_cover_verification_status_check
  check (cover_verification_status in ('missing', 'candidate', 'verified', 'rejected'));

alter table public.manga_editions drop constraint if exists manga_editions_verified_cover_requires_source_check;
alter table public.manga_editions
  add constraint manga_editions_verified_cover_requires_source_check
  check (cover_verification_status <> 'verified' or (cover_image_url is not null and cover_source_url is not null and cover_source_name is not null));

-- Existing imports may remain candidates for staff review, but never display publicly.
update public.manga_editions
set cover_verification_status = case when cover_image_url is null then 'missing' else 'candidate' end
where cover_verification_status = 'missing';

comment on column public.manga_editions.cover_image_url is 'Exact-edition cover URL. Only public when cover verification status is verified.';
comment on column public.manga_editions.cover_source_url is 'Publisher or licensed catalogue record that supplied the cover image.';
comment on column public.manga_editions.cover_source_name is 'Owner of the cover source, e.g. VIZ Media or Shueisha.';
comment on column public.manga_editions.cover_verification_status is 'missing, candidate, verified, or rejected. Marketplace listing photos are excluded.';
