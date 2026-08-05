-- Cover-sourcing sprint: verified publisher-direct covers for target-series
-- gaps found via a live audit of manga_editions.cover_verification_status.
-- Each row below was confirmed by opening the named publisher's own product
-- page and matching its printed ISBN exactly to the edition below before
-- recording it here. No marketplace listing photo was used as a source.

with verified_covers (isbn_13, cover_image_url, cover_source_url, cover_source_name) as (
  values
    -- On the homepage "new arrivals" list at the time of this audit.
    (
      '9784063842760',
      'https://dvs-cover.kodansha.co.jp/0000017064/qLLMwJdlqPdbWsGu48rCYwKGmqTQevk4XcM1yTlp.jpg',
      'https://www.kodansha.co.jp/comic/products/0000017064',
      'Kodansha official product record'
    ),
    (
      '9784063235678',
      'https://dvs-cover.kodansha.co.jp/0000006854/ROSjH8ngeDxDMjseSlCs8FWrHUCew1G0BdYtoPf1.jpg',
      'https://www.kodansha.co.jp/comic/products/0000006854',
      'Kodansha official product record'
    ),
    (
      '9781591164418',
      'https://dw9to29mmj727.cloudfront.net/products/1591164419.jpg',
      'https://www.viz.com/manga-books/manga/bleach-volume-1-0/product/167',
      'VIZ official product record'
    ),
    (
      '9781569319000',
      'https://dw9to29mmj727.cloudfront.net/products/1569319006.jpg',
      'https://www.viz.com/manga-books/manga/naruto-volume-1/product/91',
      'VIZ official product record'
    ),
    (
      '9781591161783',
      'https://dw9to29mmj727.cloudfront.net/products/1591161789.jpg',
      'https://www.viz.com/manga-books/manga/naruto-volume-2/product/92',
      'VIZ official product record'
    ),
    (
      '9781591161875',
      'https://dw9to29mmj727.cloudfront.net/products/1591161878.jpg',
      'https://www.viz.com/manga-books/manga/naruto-volume-3/product/93',
      'VIZ official product record'
    ),
    (
      '9781421536255',
      'https://dw9to29mmj727.cloudfront.net/products/1421536250.jpg',
      'https://www.viz.com/read/manga/one-piece-omnibus-edition-volume-1/product/2452',
      'VIZ official product record'
    )
)
update public.manga_editions as edition
set
  cover_image_url = verified_covers.cover_image_url,
  cover_source_url = verified_covers.cover_source_url,
  cover_source_name = verified_covers.cover_source_name,
  cover_verification_status = 'verified',
  cover_verified_at = coalesce(edition.cover_verified_at, now())
from verified_covers
where edition.isbn_13 = verified_covers.isbn_13
  and edition.cover_verification_status is distinct from 'verified';
