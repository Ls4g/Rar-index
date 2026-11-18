-- Collector galleries group a series run into one bay on the Wall view and,
-- by default, show the catalogued volumes the collector does not own as
-- outlines. This lets a collector hide those gaps from visitors.
alter table public.collector_gallery_layouts
  add column if not exists show_missing_volumes boolean not null default true;
