-- Verified publisher-direct covers for the agreed Vol. 1 priority batch.
-- These update cover provenance only; they do not make any printing claim.

with verified_covers (isbn_13, cover_image_url, cover_source_url, cover_source_name) as (
  values
    (
      '9784088804163',
      'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088804163/500/9784088804163.jpg',
      'https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-880416-3',
      'Shueisha official record'
    ),
    (
      '9784088732138',
      'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088732138/500/9784088732138.jpg',
      'https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-873213-8',
      'Shueisha official record'
    ),
    (
      '9784088815169',
      'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088815169/500/9784088815169.jpg',
      'https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-881516-9',
      'Shueisha official record'
    ),
    (
      '9784088838199',
      'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088838199/500/9784088838199.jpg',
      'https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-883819-9',
      'Shueisha official record'
    ),
    (
      '9784088728407',
      'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088728407/500/9784088728407.jpg',
      'https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-872840-7',
      'Shueisha official record'
    ),
    (
      '9784088807232',
      'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088807232/500/9784088807232.jpg',
      'https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-880723-2',
      'Shueisha official record'
    ),
    (
      '9784088725710',
      'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088725710/500/9784088725710.jpg',
      'https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-872571-0',
      'Shueisha official record'
    ),
    (
      '9781421587189',
      'https://dw9to29mmj727.cloudfront.net/products/1421587181.jpg',
      'https://www.viz.com/manga-books/manga/black-clover-volume-1/product/4795',
      'VIZ official product record'
    ),
    (
      '9781974700523',
      'https://shop.viz.com/cdn/shop/files/white-9781974700523.jpg?v=1743521852',
      'https://shop.viz.com/products/demon-slayer-kimetsu-no-yaiba-vol-1',
      'VIZ official product record'
    ),
    (
      '9781612620244',
      'https://production.image.azuki.co/dbbce4fb-a8e3-4813-8fb4-418bdde97eba/800.webp',
      'https://kodansha.us/series/attack-on-titan/volume-1/',
      'Kodansha official product record'
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
