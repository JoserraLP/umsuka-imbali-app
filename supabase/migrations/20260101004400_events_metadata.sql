-- =========================================================
-- UMSUKA IMBALI APP — 0044: events metadata
-- =========================================================
-- Adds optional metadata columns to umsuka.events so the event detail
-- page can show a location, a hero image and a registration deadline:
--   - registration_deadline: after this instant no new registrations are
--     accepted and members fall back to the event waitlist.
--   - location: free-text venue description.
--   - image_url: optional banner image (http/https only).
-- All columns are nullable/additive, existing rows are unaffected.

alter table umsuka.events
  add column registration_deadline timestamptz,
  add column location text,
  add column image_url text;

-- A deadline in the past relative to the event creation is meaningless
-- (the event would be closed before it exists).
alter table umsuka.events
  add constraint chk_events_registration_deadline_after_created
  check (registration_deadline is null or registration_deadline > created_at);

-- Mirrors the client-side zod validation: only http/https URLs without
-- whitespace are accepted.
alter table umsuka.events
  add constraint chk_events_image_url_http
  check (image_url is null or image_url ~ '^https?://[^[:space:]]+$');

create index idx_events_registration_deadline on umsuka.events (registration_deadline);

comment on column umsuka.events.registration_deadline is
  'Optional cutoff instant for new registrations. After it passes, members join the waitlist instead.';
comment on column umsuka.events.location is
  'Optional free-text venue/location description shown on the event detail page.';
comment on column umsuka.events.image_url is
  'Optional banner image URL (http/https). Rendered with a plain <img> tag.';
