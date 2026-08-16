-- Reader-facing series introductions are editorial catalogue data, separate
-- from edition verification notes and market evidence.

create table if not exists public.series_profiles (
  series_key text primary key,
  display_name text not null,
  tagline text,
  synopsis text not null,
  source_name text not null,
  source_url text not null,
  is_verified boolean not null default false,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint series_profiles_key_not_blank check (length(trim(series_key)) > 0),
  constraint series_profiles_synopsis_length check (length(trim(synopsis)) between 24 and 1200),
  constraint series_profiles_verified_source check (
    not is_verified or (
      length(trim(source_name)) > 0
      and source_url ~ '^https://'
      and reviewed_by is not null
      and reviewed_at is not null
    )
  )
);

alter table public.series_profiles enable row level security;

drop policy if exists "Verified series profiles are public" on public.series_profiles;
create policy "Verified series profiles are public"
  on public.series_profiles for select
  using (is_verified = true);

comment on table public.series_profiles is
  'Source-backed reader introductions. These never constitute edition or price evidence.';

insert into public.series_profiles (
  series_key, display_name, tagline, synopsis, source_name, source_url,
  is_verified, reviewed_by, reviewed_at
) values
  ('one piece', 'One Piece', 'A voyage for the world''s greatest treasure.', 'Monkey D. Luffy sets out to become King of the Pirates, gathering a crew and crossing dangerous seas in search of the legendary treasure known as the One Piece.', 'VIZ Media', 'https://www.viz.com/one-piece', true, 'RAR editorial review', now()),
  ('naruto', 'Naruto', 'A young ninja determined to earn his village''s respect.', 'Naruto Uzumaki is a mischievous young shinobi who dreams of becoming Hokage, the leader of his village, while learning what it means to protect the people around him.', 'VIZ Media', 'https://www.viz.com/naruto', true, 'RAR editorial review', now()),
  ('bleach', 'Bleach', 'A teenager caught between the living and the dead.', 'Ichigo Kurosaki can see ghosts, but his life changes when he inherits the powers of a Soul Reaper and becomes responsible for protecting people from dangerous spirits.', 'VIZ Media', 'https://www.viz.com/bleach', true, 'RAR editorial review', now()),
  ('dragon ball', 'Dragon Ball', 'Adventure, rivalry and a search for seven mystical orbs.', 'Goku travels in search of the Dragon Balls, meeting friends and increasingly powerful rivals as a light-hearted journey grows into a vast martial-arts adventure.', 'VIZ Media', 'https://www.viz.com/dragon-ball', true, 'RAR editorial review', now()),
  ('berserk', 'Berserk', 'A lone swordsman fights through a brutal dark-fantasy world.', 'Guts, a mercenary marked by violence and betrayal, struggles against human ambition and supernatural forces in Kentaro Miura''s dark-fantasy epic.', 'Dark Horse Comics', 'https://digital.darkhorse.com/series/826/berserk', true, 'RAR editorial review', now()),
  ('akira', 'Akira', 'Neo-Tokyo, biker gangs and power that cannot be controlled.', 'In a rebuilt Neo-Tokyo, biker Kaneda is drawn into secret government experiments after his friend Tetsuo develops destructive psychic abilities.', 'Kodansha', 'https://kodansha.us/series/akira/', true, 'RAR editorial review', now()),
  ('hunter x hunter', 'Hunter × Hunter', 'Gon enters a dangerous world to find his father.', 'Gon Freecss pursues a Hunter licence and the trail of his absent father, entering a world of rare creatures, criminals and tests where intelligence matters as much as strength.', 'VIZ Media', 'https://www.viz.com/hunter-x-hunter', true, 'RAR editorial review', now()),
  ('black clover', 'Black Clover', 'A magicless boy aims to become the Wizard King.', 'Born without magic in a world ruled by it, Asta gains an anti-magic grimoire and refuses to abandon his ambition of becoming the Wizard King.', 'VIZ Media', 'https://www.viz.com/black-clover', true, 'RAR editorial review', now()),
  ('demon slayer kimetsu no yaiba', 'Demon Slayer: Kimetsu no Yaiba', 'A brother''s fight to save his sister.', 'After demons destroy his family and transform his sister Nezuko, Tanjiro Kamado joins the Demon Slayer Corps in search of a cure and the creature responsible.', 'VIZ Media', 'https://www.viz.com/demon-slayer-kimetsu-no-yaiba', true, 'RAR editorial review', now()),
  ('initial d', 'Initial D', 'A tofu delivery route becomes a street-racing education.', 'Takumi Fujiwara''s nightly deliveries over Mount Akina have quietly made him an exceptional downhill driver, drawing him into Japan''s street-racing scene.', 'Kodansha', 'https://kodansha.us/series/initial-d/', true, 'RAR editorial review', now()),
  ('jujutsu kaisen', 'Jujutsu Kaisen', 'A student pulled into a war against cursed spirits.', 'Yuji Itadori enters the hidden world of jujutsu sorcerers after swallowing a powerful cursed object and becoming host to the feared Ryomen Sukuna.', 'VIZ Media', 'https://www.viz.com/jujutsu-kaisen', true, 'RAR editorial review', now()),
  ('kagurabachi', 'Kagurabachi', 'An enchanted blade and a mission of revenge.', 'Chihiro Rokuhira wields the final enchanted sword forged by his murdered father as he hunts the sorcerers who stole the other blades.', 'VIZ Media', 'https://www.viz.com/kagurabachi', true, 'RAR editorial review', now()),
  ('attack on titan', 'Attack on Titan', 'Humanity survives behind walls until the Titans return.', 'Eren Yeager dreams of exploring the world beyond humanity''s walls, but a devastating Titan attack turns that dream into a fight for survival and freedom.', 'Kodansha', 'https://kodansha.us/series/attack-on-titan/', true, 'RAR editorial review', now())
on conflict (series_key) do update set
  display_name = excluded.display_name,
  tagline = excluded.tagline,
  synopsis = excluded.synopsis,
  source_name = excluded.source_name,
  source_url = excluded.source_url,
  is_verified = excluded.is_verified,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  updated_at = now();
