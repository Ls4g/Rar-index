create table if not exists public.homepage_feature_selections (
  id uuid primary key default gen_random_uuid(),
  slot text not null default 'edition_of_week' check (slot in ('edition_of_week')),
  edition_id uuid not null references public.manga_editions(id) on delete restrict,
  selection_method text not null default 'manual' check (selection_method in ('manual', 'rating')),
  accent_color text not null default '#e31b23' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  selection_note text,
  selection_score numeric,
  score_details jsonb,
  selected_by text not null,
  selected_at timestamptz not null default now()
);

create index if not exists homepage_feature_selections_slot_selected_at_idx
  on public.homepage_feature_selections (slot, selected_at desc);

alter table public.homepage_feature_selections enable row level security;

insert into public.homepage_feature_selections (
  slot,
  edition_id,
  selection_method,
  accent_color,
  selection_note,
  selected_by
)
select
  'edition_of_week',
  edition.id,
  'manual',
  '#e31b23',
  'Initial staff-approved homepage spotlight.',
  'migration'
from public.manga_editions as edition
where edition.isbn_13 = '9781569319208'
  and edition.language = 'English'
  and edition.record_kind = 'publication'
  and edition.is_verified = true
  and not exists (
    select 1
    from public.homepage_feature_selections existing
    where existing.slot = 'edition_of_week'
  )
limit 1;
