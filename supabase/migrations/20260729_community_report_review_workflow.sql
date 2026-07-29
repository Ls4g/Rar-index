-- Staff decisions on community evidence are auditable and cannot alter pricing directly.
create table if not exists public.community_report_decisions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.community_sale_reports(id) on delete cascade,
  decision text not null check (decision in ('reviewed', 'rejected', 'converted')),
  decision_notes text not null check (length(trim(decision_notes)) >= 12),
  reviewed_by text not null,
  created_at timestamptz not null default now()
);

alter table public.community_report_decisions enable row level security;

create index if not exists community_report_decisions_report_created_idx
  on public.community_report_decisions(report_id, created_at desc);

create or replace function public.apply_community_report_decision(
  p_report_id uuid,
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
  if p_decision not in ('reviewed', 'rejected', 'converted') then
    raise exception 'Invalid community report decision';
  end if;
  if length(trim(coalesce(p_decision_notes, ''))) < 12 then
    raise exception 'Decision notes must contain at least 12 characters';
  end if;
  if length(trim(coalesce(p_reviewed_by, ''))) = 0 then
    raise exception 'Reviewer is required';
  end if;

  update public.community_sale_reports
  set status = p_decision,
      staff_notes = trim(p_decision_notes),
      reviewed_by = trim(p_reviewed_by),
      reviewed_at = now()
  where id = p_report_id
    and status = 'pending';

  if not found then
    raise exception 'Community report % is not pending or does not exist', p_report_id;
  end if;

  insert into public.community_report_decisions (report_id, decision, decision_notes, reviewed_by)
  values (p_report_id, p_decision, trim(p_decision_notes), trim(p_reviewed_by));
end;
$$;

revoke all on function public.apply_community_report_decision(uuid, text, text, text) from public;
