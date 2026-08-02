-- Add the VIZ source to the standard English One Piece Vol. 1 record through
-- the catalogue queue and named review flow. It does not prove any printing.

do $$
declare
  viz_source_id uuid;
  import_id uuid;
  existing_edition_id uuid;
  resulting_edition_id uuid;
  import_status text;
begin
  select id
  into viz_source_id
  from public.sources
  where lower(name) = 'viz media'
    and source_type = 'publisher'
  limit 1;

  if viz_source_id is null then
    raise exception 'VIZ Media publisher source is required before importing One Piece Vol. 1';
  end if;

  -- The generic publisher record is linked only to the standard, unnumbered
  -- printing record. It must never be used to substantiate the separate 9th-print record.
  select id
  into existing_edition_id
  from public.manga_editions
  where isbn_13 = '9781569319017'
    and language = 'English'
    and volume_number = '1'
    and printing_number is null
  limit 1;

  -- This source was captured before the formal queue existed in this project.
  -- Preserve that provenance and add the now-verified cover without creating a
  -- duplicate source link or second review decision.
  if existing_edition_id is not null and exists (
    select 1
    from public.edition_sources
    where edition_id = existing_edition_id
      and source_id = viz_source_id
      and source_record_url = 'https://www.viz.com/manga-books/manga/one-piece-volume-1/product/139'
  ) then
    update public.manga_editions
    set cover_image_url = 'https://dw9to29mmj727.cloudfront.net/products/1569319014.jpg',
        cover_source_url = 'https://www.viz.com/manga-books/manga/one-piece-volume-1/product/139',
        cover_source_name = 'VIZ official product record',
        cover_verification_status = 'verified',
        cover_verified_at = coalesce(cover_verified_at, now())
    where id = existing_edition_id;
    return;
  end if;

  select id, status
  into import_id, import_status
  from public.catalogue_import_queue
  where source_id = viz_source_id
    and external_id = 'viz-product-139';

  if import_id is not null and import_status in ('approved', 'linked') then
    return;
  end if;

  if import_id is null then
    insert into public.catalogue_import_queue (
      source_id,
      external_id,
      source_record_url,
      raw_payload,
      candidate_kind,
      candidate_title,
      candidate_series,
      candidate_volume_number,
      candidate_author,
      candidate_publisher,
      candidate_language,
      candidate_isbn_13,
      candidate_release_date,
      candidate_format,
      candidate_cover_image_url
    ) values (
      viz_source_id,
      'viz-product-139',
      'https://www.viz.com/manga-books/manga/one-piece-volume-1/product/139',
      jsonb_build_object(
        'title', 'One Piece, Vol. 1',
        'series', 'One Piece',
        'volume_number', '1',
        'author', 'Eiichiro Oda',
        'publisher', 'VIZ Media',
        'language', 'English',
        'isbn_13', '9781569319017',
        'release_date', '2003-09-02',
        'format', 'Paperback',
        'cover_image_url', 'https://dw9to29mmj727.cloudfront.net/products/1569319014.jpg',
        'source_record_url', 'https://www.viz.com/manga-books/manga/one-piece-volume-1/product/139'
      ),
      'edition_candidate',
      'One Piece, Vol. 1',
      'One Piece',
      '1',
      'Eiichiro Oda',
      'VIZ Media',
      'English',
      '9781569319017',
      date '2003-09-02',
      'Paperback',
      'https://dw9to29mmj727.cloudfront.net/products/1569319014.jpg'
    ) returning id into import_id;
  end if;

  if existing_edition_id is null then
    select public.apply_catalogue_review(
      import_id,
      'approve_new',
      'Exact VIZ product record matched title, ISBN, language and release date.',
      'RAR catalogue review',
      null,
      null
    ) into resulting_edition_id;
  else
    select public.apply_catalogue_review(
      import_id,
      'link_existing',
      'Exact VIZ record linked to the standard English paperback; printing remains unrecorded.',
      'RAR catalogue review',
      existing_edition_id,
      null
    ) into resulting_edition_id;
  end if;

  update public.manga_editions
  set cover_image_url = 'https://dw9to29mmj727.cloudfront.net/products/1569319014.jpg',
      cover_source_url = 'https://www.viz.com/manga-books/manga/one-piece-volume-1/product/139',
      cover_source_name = 'VIZ official product record',
      cover_verification_status = 'verified',
      cover_verified_at = now()
  where id = resulting_edition_id;
end
$$;
