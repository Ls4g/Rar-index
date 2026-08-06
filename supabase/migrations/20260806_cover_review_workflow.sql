-- Staff Cover Review workflow: a repeatable decision + audit trail for
-- sourcing exact-edition cover art, mirroring apply_scout_lead_decision's
-- shape (single target row + one audit insert). Never overwrites history —
-- every decision, including rejections, is retained in
-- cover_review_decisions permanently.

create table if not exists public.cover_review_decisions (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.manga_editions(id) on delete cascade,
  previous_status text not null,
  decision text not null check (decision in ('candidate', 'verified', 'rejected')),
  cover_image_url text,
  cover_source_url text,
  cover_source_name text,
  decision_notes text not null,
  reviewed_by text not null,
  created_at timestamptz not null default now()
);

alter table public.cover_review_decisions enable row level security;
create index if not exists cover_review_decisions_edition_created_idx
  on public.cover_review_decisions(edition_id, created_at desc);

-- Applies one cover decision to one exact edition and logs it. Validation
-- mirrors the rules in AGENTS.md: verified requires full provenance
-- (image URL, source record URL, source name) plus reviewer and a
-- meaningful note; candidate needs at least one URL plus reviewer/note;
-- rejected only needs reviewer/note. A rejection clears the live cover
-- fields (the disproven candidate should not linger as if still under
-- consideration) but the audit row keeps exactly what was reviewed and
-- rejected, so the decision is never lost.
create or replace function public.apply_cover_review(
  p_edition_id uuid,
  p_decision text,
  p_cover_image_url text,
  p_cover_source_url text,
  p_cover_source_name text,
  p_decision_notes text,
  p_reviewed_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_image_url text := nullif(trim(coalesce(p_cover_image_url, '')), '');
  v_source_url text := nullif(trim(coalesce(p_cover_source_url, '')), '');
  v_source_name text := nullif(trim(coalesce(p_cover_source_name, '')), '');
  v_notes text := nullif(trim(coalesce(p_decision_notes, '')), '');
  v_reviewer text := nullif(trim(coalesce(p_reviewed_by, '')), '');
  v_previous_status text;
begin
  if p_decision not in ('candidate', 'verified', 'rejected') then
    raise exception 'Invalid cover review decision';
  end if;
  if v_reviewer is null then
    raise exception 'Reviewer is required';
  end if;
  if v_notes is null or length(v_notes) < 12 then
    raise exception 'A review note of at least 12 characters is required';
  end if;
  if p_decision = 'verified' and (v_image_url is null or v_source_url is null or v_source_name is null) then
    raise exception 'A verified cover requires an image URL, a source record URL, and a source name';
  end if;
  if p_decision = 'candidate' and v_image_url is null and v_source_url is null then
    raise exception 'A candidate cover needs at least an image URL or a source record URL';
  end if;

  select cover_verification_status into v_previous_status
  from public.manga_editions
  where id = p_edition_id
  for update;

  if not found then
    raise exception 'Edition % does not exist', p_edition_id;
  end if;

  if p_decision = 'rejected' then
    update public.manga_editions
    set cover_image_url = null,
        cover_source_url = null,
        cover_source_name = null,
        cover_verification_status = 'rejected',
        cover_verified_at = null,
        updated_at = now()
    where id = p_edition_id;
  else
    update public.manga_editions
    set cover_image_url = v_image_url,
        cover_source_url = v_source_url,
        cover_source_name = v_source_name,
        cover_verification_status = p_decision,
        cover_verified_at = case when p_decision = 'verified' then now() else null end,
        updated_at = now()
    where id = p_edition_id;
  end if;

  insert into public.cover_review_decisions (
    edition_id, previous_status, decision, cover_image_url, cover_source_url, cover_source_name, decision_notes, reviewed_by
  ) values (
    p_edition_id, v_previous_status, p_decision, v_image_url, v_source_url, v_source_name, v_notes, trim(p_reviewed_by)
  );
end;
$$;

revoke all on function public.apply_cover_review(uuid, text, text, text, text, text, text) from public;

-- Staff priority queue: every verified catalogue edition that does not yet
-- have a verified cover (missing, candidate, or rejected), with the
-- verified-sale count staff need to prioritise the highest-value gaps
-- first (an edition already earning sales is exactly the one that would
-- benefit most from appearing on the homepage shelf once its cover is
-- confirmed).
create or replace view public.cover_review_queue
with (security_invoker = true)
as
select
  edition.id as edition_id,
  edition.title,
  edition.series,
  edition.volume_number,
  edition.language,
  edition.publisher,
  edition.isbn_13,
  edition.edition_statement,
  edition.printing_number,
  edition.variant_name,
  edition.collectible_type,
  edition.cover_image_url,
  edition.cover_source_url,
  edition.cover_source_name,
  edition.cover_verification_status,
  edition.cover_verified_at,
  edition.printing_of_edition_id,
  coalesce(sales.verified_sale_count, 0) as verified_sale_count
from public.manga_editions edition
left join (
  select edition_id, count(*)::integer as verified_sale_count
  from public.price_observations
  where match_status = 'verified_match' and sale_status = 'confirmed'
  group by edition_id
) sales on sales.edition_id = edition.id
where edition.is_verified
  and edition.cover_verification_status <> 'verified';
