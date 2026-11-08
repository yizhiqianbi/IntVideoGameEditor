PRAGMA foreign_keys = ON;

-- Every account has a stable, shareable invite code. Codes are derived from
-- the server-assigned UUID so existing accounts can be backfilled safely.
ALTER TABLE users ADD COLUMN referral_code TEXT;
UPDATE users
SET referral_code = 'XM' || substr(upper(replace(id, '-', '')), 1, 30)
WHERE referral_code IS NULL AND is_demo=0;
CREATE UNIQUE INDEX users_referral_code_unique ON users(referral_code)
  WHERE referral_code IS NOT NULL;

-- A successful registration can consume one invite only. The unique invitee
-- constraint keeps retries and concurrent registration requests idempotent.
CREATE TABLE referral_events (
  id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  CHECK(inviter_id<>invitee_id)
);
CREATE INDEX referral_events_inviter ON referral_events(inviter_id, created_at DESC);

-- Community points are intentionally separate from Credit/model billing and
-- from task claims. One reward is created for each successful invitation.
CREATE TABLE referral_rewards (
  referral_id TEXT PRIMARY KEY REFERENCES referral_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK(points=20),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  expires_at INTEGER CHECK(expires_at IS NULL)
);
CREATE INDEX referral_rewards_owner ON referral_rewards(user_id, created_at DESC);
