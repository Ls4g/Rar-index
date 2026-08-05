-- Cover-sourcing sprint: Bleach Vol. 2-10 English and Dragon Ball Vol. 1-10
-- English, all VIZ Media. Each row was confirmed by opening the exact
-- product page on viz.com and matching its printed ISBN-13 exactly to the
-- edition below, following the same pattern as prior cover migrations.
-- Dragon Ball, Vol. 1: The Monkey King (ISBN 9781569314951) is a separate,
-- older, out-of-print VIZ printing with no current rights-holder page and
-- is intentionally left out of this batch — it stays 'missing'.

with verified_covers (isbn_13, cover_image_url, cover_source_url, cover_source_name) as (
  values
    ('9781591164425', 'https://dw9to29mmj727.cloudfront.net/products/1591164427.jpg', 'https://www.viz.com/manga-books/manga/bleach-volume-2-0/product/168', 'VIZ official product record'),
    ('9781591164432', 'https://dw9to29mmj727.cloudfront.net/products/1591164435.jpg', 'https://www.viz.com/manga-books/manga/bleach-volume-3-0/product/169', 'VIZ official product record'),
    ('9781591164449', 'https://dw9to29mmj727.cloudfront.net/products/1591164443.jpg', 'https://www.viz.com/manga-books/manga/bleach-volume-4-0/product/170', 'VIZ official product record'),
    ('9781591164456', 'https://dw9to29mmj727.cloudfront.net/products/1591164451.jpg', 'https://www.viz.com/manga-books/manga/bleach-volume-5-0/product/171', 'VIZ official product record'),
    ('9781591167280', 'https://dw9to29mmj727.cloudfront.net/products/1591167280.jpg', 'https://www.viz.com/manga-books/manga/bleach-volume-6-0/product/375', 'VIZ official product record'),
    ('9781591168072', 'https://dw9to29mmj727.cloudfront.net/products/1591168074.jpg', 'https://www.viz.com/manga-books/manga/bleach-volume-7-0/product/376', 'VIZ official product record'),
    ('9781591168720', 'https://dw9to29mmj727.cloudfront.net/products/1591168724.jpg', 'https://www.viz.com/manga-books/manga/bleach-volume-8-0/product/573', 'VIZ official product record'),
    ('9781591169246', 'https://dw9to29mmj727.cloudfront.net/products/1591169240.jpg', 'https://www.viz.com/manga-books/manga/bleach-volume-9-0/product/574', 'VIZ official product record'),
    ('9781421500812', 'https://dw9to29mmj727.cloudfront.net/products/1421500817.jpg', 'https://www.viz.com/manga-books/manga/bleach-volume-10-0/product/575', 'VIZ official product record'),
    ('9781569319208', 'https://dw9to29mmj727.cloudfront.net/products/1569319200.jpg', 'https://www.viz.com/manga-books/manga/dragon-ball-volume-1-0/product/104', 'VIZ official product record'),
    ('9781569319215', 'https://dw9to29mmj727.cloudfront.net/products/1569319219.jpg', 'https://www.viz.com/manga-books/manga/dragon-ball-volume-2-0/product/105', 'VIZ official product record'),
    ('9781569319222', 'https://dw9to29mmj727.cloudfront.net/products/1569319227.jpg', 'https://www.viz.com/manga-books/manga/dragon-ball-volume-3-0/product/106', 'VIZ official product record'),
    ('9781569319239', 'https://dw9to29mmj727.cloudfront.net/products/1569319235.jpg', 'https://www.viz.com/manga-books/manga/dragon-ball-volume-4-0/product/107', 'VIZ official product record'),
    ('9781569319246', 'https://dw9to29mmj727.cloudfront.net/products/1569319243.jpg', 'https://www.viz.com/manga-books/manga/dragon-ball-volume-5-0/product/108', 'VIZ official product record'),
    ('9781569319253', 'https://dw9to29mmj727.cloudfront.net/products/1569319251.jpg', 'https://www.viz.com/manga-books/manga/dragon-ball-volume-6-0/product/109', 'VIZ official product record'),
    ('9781569319260', 'https://dw9to29mmj727.cloudfront.net/products/156931926X.jpg', 'https://www.viz.com/manga-books/manga/dragon-ball-volume-7-0/product/110', 'VIZ official product record'),
    ('9781569319277', 'https://dw9to29mmj727.cloudfront.net/products/1569319278.jpg', 'https://www.viz.com/manga-books/manga/dragon-ball-volume-8-0/product/112', 'VIZ official product record'),
    ('9781569319284', 'https://dw9to29mmj727.cloudfront.net/products/1569319286.jpg', 'https://www.viz.com/manga-books/manga/dragon-ball-volume-9-0/product/113', 'VIZ official product record'),
    ('9781569319291', 'https://dw9to29mmj727.cloudfront.net/products/1569319294.jpg', 'https://www.viz.com/manga-books/manga/dragon-ball-volume-10-0/product/114', 'VIZ official product record')
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
