-- Outcome checks, not a claim about total eBay HTTP usage. Reservations are
-- shared by manual and scheduled runs. Crashed runs retain their allocation
-- until the next UTC day; uncertainty never creates extra spending room.
create table if not exists public.outcome_check_budgets (
  budget_day date primary key,
  reserved integer not null default 0 check (reserved >= 0)
);
create table if not exists public.outcome_check_reservations (
  id uuid primary key,
  budget_day date not null references public.outcome_check_budgets,
  granted integer not null check (granted between 0 and 600),
  settled boolean not null default false
);
alter table public.outcome_check_budgets enable row level security;
alter table public.outcome_check_reservations enable row level security;
revoke all on public.outcome_check_budgets, public.outcome_check_reservations from public, anon, authenticated;
grant all on public.outcome_check_budgets, public.outcome_check_reservations to service_role;

create or replace function public.reserve_outcome_checks(p_reservation_id uuid, p_requested integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_reserved integer; v_spent integer; v_grant integer;
begin
  if p_reservation_id is null or p_requested is null or p_requested < 0 or p_requested > 600 then
    raise exception 'Request between 0 and 600 outcome checks with a reservation id.';
  end if;
  insert into outcome_check_budgets(budget_day) values(v_day) on conflict do nothing;
  select reserved into v_reserved from outcome_check_budgets where budget_day=v_day for update;
  -- A reservation is single use, including a retry after a lost response.
  -- Refuse reuse rather than letting two requests spend the same allocation.
  if exists(select 1 from outcome_check_reservations where id=p_reservation_id) then
    raise exception 'This outcome-check reservation has already been issued.';
  end if;
  select count(*) into v_spent from listing_outcome_checks
    where checked_at >= (v_day::timestamp at time zone 'UTC');
  v_reserved := greatest(v_reserved, v_spent);
  v_grant := least(p_requested, greatest(0, 2500-v_reserved));
  insert into outcome_check_reservations(id,budget_day,granted) values(p_reservation_id,v_day,v_grant);
  update outcome_check_budgets set reserved=v_reserved+v_grant where budget_day=v_day;
  return jsonb_build_object('granted',v_grant,'spent',v_spent,'reserved',v_reserved+v_grant,
    'remaining',greatest(0,2500-v_reserved-v_grant),'day',v_day);
end;
$$;

create or replace function public.settle_outcome_checks(p_reservation_id uuid, p_attempted integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_day date; v_row outcome_check_reservations%rowtype;
begin
  select budget_day into v_day from outcome_check_reservations where id=p_reservation_id;
  if not found then raise exception 'Unknown outcome-check reservation.'; end if;
  perform 1 from outcome_check_budgets where budget_day=v_day for update;
  select * into v_row from outcome_check_reservations where id=p_reservation_id for update;
  if v_row.settled then return; end if;
  if p_attempted is null or p_attempted < 0 or p_attempted > v_row.granted then
    raise exception 'Attempt count is outside this reservation.';
  end if;
  update outcome_check_budgets set reserved=reserved-(v_row.granted-p_attempted) where budget_day=v_day;
  update outcome_check_reservations set settled=true where id=p_reservation_id;
end;
$$;
revoke all on function public.reserve_outcome_checks(uuid,integer), public.settle_outcome_checks(uuid,integer) from public, anon, authenticated;
grant execute on function public.reserve_outcome_checks(uuid,integer), public.settle_outcome_checks(uuid,integer) to service_role;
