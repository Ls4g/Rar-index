-- Repair six imported One Piece publication rows whose bibliographic source
-- supplied title/ISBN but left series and volume empty. The ISBNs and titles
-- already establish these identities; no sale, print-run or review data moves.
update public.manga_editions as edition
set
  series = repair.series,
  volume_number = repair.volume_number
from (values
  ('50ab41b0-8da2-44ab-b61c-add000ca7445'::uuid, 'One Piece'::text, '13'::text),
  ('f02f3591-c438-4fe6-a71f-17d7b0622046'::uuid, 'One Piece'::text, '5'::text),
  ('f6fcf520-8abc-4433-aaed-4a41527c7b82'::uuid, 'One Piece'::text, '10'::text),
  ('f640de3d-e29c-41d5-9882-b0e822b0aac2'::uuid, 'One Piece'::text, '14'::text),
  ('ab0ed853-5aca-4436-a5bd-4a90e6233669'::uuid, 'One Piece'::text, '2'::text),
  ('2c41d928-66a9-4e18-af3f-fd97164c4753'::uuid, 'One Piece'::text, '3'::text)
) as repair(id, series, volume_number)
where edition.id = repair.id
  and edition.record_kind = 'publication'
  and edition.series is null
  and edition.volume_number is null;
