-- Standardise all existing eBay search profiles without destroying their
-- collection-run history. One exact edition should have one active eBay
-- profile, so Scout never performs two searches for the same edition.

-- The original uniqueness rule included the search text, which allowed
-- duplicate active profiles for one edition when their wording differed.
-- Replace it with a partial rule: one *active* eBay profile per edition.
alter table public.marketplace_search_profiles
  drop constraint if exists marketplace_search_profiles_edition_id_source_id_search_que_key;

-- Rank duplicate profiles by useful existing activity. The selected canonical
-- profile remains active only when that edition already had an active profile;
-- explicitly paused searches remain paused.
create temporary table ebay_profile_standardisation on commit drop as
with profile_activity as (
  select
    profile.id,
    profile.edition_id,
    profile.source_id,
    profile.search_query,
    profile.scope_notes,
    profile.collection_interval_days,
    profile.is_active,
    profile.last_checked_at,
    profile.created_at,
    edition.title,
    edition.series,
    edition.volume_number,
    edition.language,
    edition.isbn_13,
    edition.printing_number,
    count(run.id)::integer as run_count,
    max(run.checked_at) as most_recent_run_at
  from public.marketplace_search_profiles profile
  join public.sources source on source.id = profile.source_id
  join public.manga_editions edition on edition.id = profile.edition_id
  left join public.marketplace_collection_runs run on run.profile_id = profile.id
  where source.name = 'eBay Sold'
  group by
    profile.id, profile.edition_id, profile.source_id, profile.search_query,
    profile.scope_notes, profile.collection_interval_days, profile.is_active,
    profile.last_checked_at, profile.created_at, edition.title, edition.series,
    edition.volume_number, edition.language, edition.isbn_13, edition.printing_number
), ranked as (
  select
    profile_activity.*,
    count(*) over (partition by edition_id, source_id) as profile_count,
    bool_or(is_active) over (partition by edition_id, source_id) as had_an_active_profile,
    row_number() over (
      partition by edition_id, source_id
      order by
        is_active desc,
        run_count desc,
        most_recent_run_at desc nulls last,
        last_checked_at desc nulls last,
        created_at asc
    ) as profile_rank
  from profile_activity
)
select
  id,
  trim(regexp_replace(concat_ws(' ',
    coalesce(nullif(trim(series), ''), nullif(trim(title), '')),
    'manga',
    case
      when volume_number is not null then 'Vol. ' || trim(volume_number::text)
      else 'Vol.'
    end,
    nullif(trim(language), ''),
    nullif(trim(isbn_13), ''),
    case when printing_number = 1 then 'first print' end
  ), '\s+', ' ', 'g')) as next_search_query,
  scope_notes as next_scope_notes,
  collection_interval_days as next_collection_interval_days,
  case
    when profile_count > 1 then profile_rank = 1 and had_an_active_profile
    else is_active
  end as next_is_active,
  case
    when profile_count > 1 and profile_rank > 1 and is_active then
      'Standardised eBay query and archived duplicate profile; the canonical profile remains active.'
    when profile_count > 1 and profile_rank > 1 then
      'Standardised eBay query on an already archived duplicate profile.'
    else
      'Standardised eBay query with title, manga, volume, language, ISBN, and first-print terms.'
  end as change_note
from ranked;

insert into public.marketplace_profile_revisions (
  profile_id,
  changed_by,
  change_note,
  previous_search_query,
  previous_scope_notes,
  previous_interval_days,
  previous_is_active,
  next_search_query,
  next_scope_notes,
  next_interval_days,
  next_is_active
)
select
  profile.id,
  'RAR system',
  standardisation.change_note,
  profile.search_query,
  profile.scope_notes,
  profile.collection_interval_days,
  profile.is_active,
  standardisation.next_search_query,
  standardisation.next_scope_notes,
  standardisation.next_collection_interval_days,
  standardisation.next_is_active
from public.marketplace_search_profiles profile
join ebay_profile_standardisation standardisation on standardisation.id = profile.id
where profile.search_query is distinct from standardisation.next_search_query
   or profile.is_active is distinct from standardisation.next_is_active;

update public.marketplace_search_profiles profile
set
  search_query = standardisation.next_search_query,
  scope_notes = standardisation.next_scope_notes,
  collection_interval_days = standardisation.next_collection_interval_days,
  is_active = standardisation.next_is_active,
  updated_at = now()
from ebay_profile_standardisation standardisation
where standardisation.id = profile.id
  and (
    profile.search_query is distinct from standardisation.next_search_query
    or profile.is_active is distinct from standardisation.next_is_active
  );

create unique index if not exists marketplace_search_profiles_one_active_source_edition_idx
  on public.marketplace_search_profiles (edition_id, source_id)
  where is_active = true;
