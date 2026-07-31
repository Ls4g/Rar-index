-- Keep the legacy verification flag aligned with the recorded review decision.
-- `verified_match` is the sole decision that may affect public market data.
update public.price_observations
set is_verified = true,
    updated_at = now(),
    notes = concat_ws(E'\n', notes, 'Data repair: aligned is_verified with existing verified_match review decision.')
where match_status = 'verified_match'
  and is_verified = false;
