-- Use a numeric volume label consistently on the Japanese One Piece Vol. 1
-- first-print record. This is a display/identity correction only.
update public.manga_editions
set title = 'One Piece 1'
where id = 'f85e616c-7aa8-4806-8c18-2af0d5aa78be'::uuid
  and title = 'One Piece I';
