-- First-touch acquisition. One row per account. Later links do not replace it.
CREATE TABLE acquisition_touches (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('invite_link', 'character_share', 'poster')),
  invite_code TEXT CHECK (invite_code IS NULL OR (length(invite_code) BETWEEN 6 AND 32 AND invite_code NOT GLOB '*[^A-Z0-9]*')),
  inviter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  character_id TEXT CHECK (character_id IS NULL OR length(character_id) BETWEEN 1 AND 120),
  poster TEXT CHECK (poster IS NULL OR poster IN ('catch', 'waiting', 'gaze')),
  landed_at INTEGER NOT NULL CHECK (typeof(landed_at)='integer' AND landed_at>=0),
  registered_at INTEGER CHECK (registered_at IS NULL OR (typeof(registered_at)='integer' AND registered_at>=0)),
  started_at INTEGER CHECK (started_at IS NULL OR (typeof(started_at)='integer' AND started_at>=0)),
  CHECK (inviter_id IS NULL OR inviter_id <> user_id),
  CHECK (
    (source = 'invite_link' AND character_id IS NULL AND poster IS NULL)
    OR (source = 'character_share' AND poster IS NULL)
    OR (source = 'poster' AND character_id IS NULL AND poster IS NOT NULL)
  )
);
CREATE INDEX acquisition_touches_inviter ON acquisition_touches(inviter_id, landed_at DESC);
