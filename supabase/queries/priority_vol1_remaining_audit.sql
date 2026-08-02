-- The only priority records still needing an exact official/licensed cover source.
select jsonb_agg(
  jsonb_build_object(
    'id', id,
    'title', title,
    'series', series,
    'language', language,
    'publisher', publisher,
    'isbn_13', isbn_13,
    'cover_status', cover_verification_status
  ) order by series, language
) as editions
from public.manga_editions
where volume_number = '1'
  and isbn_13 in ('9781931514989', '9784063235678', '9784063842760')
  and cover_verification_status <> 'verified';
