-- Audit the agreed priority Vol. 1 catalogue batch before cover verification.
select jsonb_agg(
  jsonb_build_object(
    'id', id,
    'title', title,
    'series', series,
    'language', language,
    'publisher', publisher,
    'isbn_13', isbn_13,
    'edition', edition_statement,
    'printing', printing_number,
    'cover_status', cover_verification_status
  ) order by series, language, printing_number nulls first, title
) as editions
from public.manga_editions
where volume_number = '1'
  and lower(series) in (
    'one piece', 'naruto', 'bleach', 'jujutsu kaisen',
    'demon slayer', 'demon slayer: kimetsu no yaiba', 'initial d',
    'kagurabachi', 'hunter x hunter', 'hunter × hunter', 'black clover',
    'attack on titan'
  );
