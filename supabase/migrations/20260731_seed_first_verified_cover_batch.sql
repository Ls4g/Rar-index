-- First exact-edition cover batch. Each image URL was read from the named
-- publisher's product page; the product page must match the ISBN below.
with verified_covers (isbn_13, image_url, source_url, source_name) as (
  values
    ('9784088725093', 'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088725093/500/9784088725093.jpg', 'https://www.shueisha.co.jp/books/items/contents.html?isbn=4-08-872509-3', 'Shueisha'),
    ('9781591167532', 'https://dw9to29mmj727.cloudfront.net/products/1591167531.jpg', 'https://www.viz.com/manga-books/manga/hunter-x-hunter-volume-1-0/product/339', 'VIZ Media'),
    ('9781974710027', 'https://dw9to29mmj727.cloudfront.net/products/1974710025.jpg', 'https://www.viz.com/manga-books/manga/jujutsu-kaisen-volume-1/product/6116/paperback', 'VIZ Media'),
    ('9781974747245', 'https://shop.viz.com/cdn/shop/files/white-9781974747245.jpg?v=1743522396', 'https://shop.viz.com/products/kagurabachi-vol-1', 'VIZ Media')
)
update public.manga_editions as edition
set cover_image_url = covers.image_url,
    cover_source_url = covers.source_url,
    cover_source_name = covers.source_name,
    cover_verification_status = 'verified',
    cover_verified_at = now()
from verified_covers as covers
where edition.isbn_13 = covers.isbn_13;
