-- A photograph of a copy on sale, shown where a cover would be.
--
-- Jump cover art is Shueisha's copyright, so no bibliographic source
-- publishes it: the Media Arts Database has no image field, and cover
-- discovery is keyed on ISBN, which a magazine has none of. A magazine
-- record therefore has no picture at all, and never will have one from a
-- licensed catalogue source.
--
-- This is NOT a cover, and deliberately not stored as one. cover_image_url
-- and cover_verification_status are untouched: an issue showing a listing
-- photo still reads as 'missing' a cover, so coverage figures stay honest
-- and 20260731_cover_image_provenance.sql's rule -- that marketplace listing
-- photos are excluded from cover verification -- holds exactly as written.
--
-- On the page it carries a visible "For sale copy" badge. That is not the
-- "Catalogue cover" badge removed in August, which labelled a cover as a
-- cover and said nothing; this one says the one thing a reader could not
-- otherwise know -- that they are looking at a seller's photograph rather
-- than publisher artwork.
alter table public.manga_editions
  add column if not exists listing_photo_url text,
  add column if not exists listing_photo_listing_url text,
  add column if not exists listing_photo_is_graded boolean,
  add column if not exists listing_photo_captured_at timestamptz;

comment on column public.manga_editions.listing_photo_url is
  'Photograph of a copy offered for sale, shown in place of a cover. Never a verified cover and never sale evidence.';
comment on column public.manga_editions.listing_photo_listing_url is
  'The listing the photograph came from, so it can be checked and re-sourced when the listing ends.';
