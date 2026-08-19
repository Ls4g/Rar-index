-- What is actually inside a magazine issue.
--
-- This is the whole reason a zasshi is collectible. A 1984 Jump is worth a
-- few pounds; the one carrying chapter 1 of Dragon Ball is not, and the only
-- difference between them is the table of contents. A magazine record without
-- its contents cannot explain its own significance.
--
-- These are catalogue facts, never price evidence. They say why an issue
-- matters. They never set, adjust or imply a value, and they are never
-- admissible as a sale: a verified sale is still a completed sale with a
-- working source link attached to one exact record.
create table if not exists public.magazine_issue_contents (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.manga_editions(id) on delete cascade,
  work_title text not null,
  creator text,
  -- 'story' is a serialised chapter, 'cover' is the cover feature, and
  -- 'feature' is everything else the magazine printed: reader pages, contests,
  -- announcements. Kept coarse because the source's own genre vocabulary has
  -- fifteen values and most of them are not worth a collector's attention.
  content_kind text not null default 'story'
    check (content_kind in ('story', 'cover', 'feature')),
  -- The source flags almost no debuts directly -- 7 across the whole run of
  -- Weekly Shonen Jump -- so this is derived from a work's earliest appearance
  -- and set by the importer, which drops anything inside the opening window of
  -- the data where a debut cannot be told from a series already running.
  is_first_appearance boolean not null default false,
  colour_note text,
  page_start numeric,
  page_end numeric,
  display_order integer,
  madb_part_id text,
  source_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per part per issue, so re-running the importer updates rather than
-- duplicates.
create unique index if not exists magazine_issue_contents_part_unique
  on public.magazine_issue_contents (edition_id, madb_part_id)
  where madb_part_id is not null;

create index if not exists magazine_issue_contents_edition_idx
  on public.magazine_issue_contents (edition_id, display_order);

-- Finding every issue a series ever appeared in, which is the question a
-- collector actually asks.
create index if not exists magazine_issue_contents_work_idx
  on public.magazine_issue_contents (work_title);

alter table public.magazine_issue_contents enable row level security;

drop policy if exists magazine_issue_contents_public_read on public.magazine_issue_contents;
create policy magazine_issue_contents_public_read
  on public.magazine_issue_contents for select
  using (true);

comment on table public.magazine_issue_contents is
  'What a magazine issue contains. Catalogue facts explaining why an issue is significant -- never price evidence, and never a substitute for a verified sale.';
