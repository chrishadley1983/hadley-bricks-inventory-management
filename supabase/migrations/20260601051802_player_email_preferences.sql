-- Player-facing transactional email preferences.
--
-- email_notifications_enabled: when false, suppresses ALL transactional player-facing
--   emails (welcome, prediction confirmations, knockout-open announcement, ...).
--   Does NOT affect admin audit emails (those use a separate channel & recipient list).
--
-- unsubscribe_token: stable per-player random UUID used as the path component
--   in /unsubscribe/<token>. Separate from players.id so the id never doubles
--   as a credential, and so we can rotate the unsubscribe link in future without
--   touching the row's identity. Generated once on player creation.
ALTER TABLE players
  ADD COLUMN email_notifications_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE players
  ADD COLUMN unsubscribe_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX players_unsubscribe_token_idx ON players (unsubscribe_token);;
