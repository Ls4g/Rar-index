-- Active listings are research leads. Staff can track or dismiss them, but
-- neither decision creates a sale, price observation, or market valuation.
alter table public.scout_listing_leads
  add column if not exists review_status text not null default 'new'
  check (review_status in ('new', 'watching', 'dismissed')),
  add column if not exists review_notes text,
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz;

create table if not exists public.scout_lead_decisions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.scout_listing_leads(id) on delete cascade,
  decision text not null check (decision in ('watching', 'dismissed')),
  decision_notes text not null,
  reviewed_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists scout_lead_decisions_lead_created_idx
  on public.scout_lead_decisions(lead_id, created_at desc);

alter table public.scout_lead_decisions enable row level security;

create or replace function public.apply_scout_lead_decision(
  p_lead_id uuid,
  p_decision text,
  p_decision_notes text,
  p_reviewed_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision not in ('watching', 'dismissed') then
    raise exception 'Invalid Scout lead decision';
  end if;
  if length(trim(coalesce(p_decision_notes, ''))) < 12 then
    raise exception 'Scout lead decisions need an evidence note';
  end if;
  if length(trim(coalesce(p_reviewed_by, ''))) = 0 then
    raise exception 'Scout lead decisions need a reviewer';
  end if;

  update public.scout_listing_leads
  set review_status = p_decision,
      review_notes = trim(p_decision_notes),
      reviewed_by = trim(p_reviewed_by),
      reviewed_at = now(),
      updated_at = now()
  where id = p_lead_id;

  if not found then
    raise exception 'Scout lead not found';
  end if;

  insert into public.scout_lead_decisions (lead_id, decision, decision_notes, reviewed_by)
  values (p_lead_id, p_decision, trim(p_decision_notes), trim(p_reviewed_by));
end;
$$;

revoke all on function public.apply_scout_lead_decision(uuid, text, text, text) from public;
