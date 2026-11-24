-- New invitations pay 20 Credit at registration, then 5 Credit on each of
-- up to three Beijing days when the invitee completes a successful round.
-- Rows created before this migration stay on reward_schedule 'legacy' and
-- keep the amount already stored in referral_rewards.
ALTER TABLE referral_events ADD COLUMN reward_schedule TEXT NOT NULL DEFAULT 'legacy';

CREATE TABLE referral_activity_rewards (
  referral_id TEXT NOT NULL REFERENCES referral_events(id) ON DELETE CASCADE,
  day_key TEXT NOT NULL CHECK(length(day_key)=10),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK(points=5),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  PRIMARY KEY (referral_id, day_key)
);
CREATE INDEX referral_activity_rewards_owner ON referral_activity_rewards(user_id, created_at DESC);

CREATE TRIGGER referral_activity_rewards_credit_after_insert
AFTER INSERT ON referral_activity_rewards
BEGIN
  INSERT OR IGNORE INTO community_credit_ledger(user_id,source_type,source_id,credits,created_at,expires_at)
    VALUES(NEW.user_id,'referral_reward',NEW.referral_id || ':' || NEW.day_key,NEW.points,NEW.created_at,NULL);
END;

-- Homepage banners. A live slot is one audience plus one position. Deleting
-- sets deleted_at and frees that slot. The public site does not treat a
-- missing orientation as male; that fallback is applied only when a specific
-- audience was requested and has no live banners.
CREATE TABLE home_banners (
  id TEXT PRIMARY KEY,
  audience TEXT NOT NULL CHECK(audience IN ('male','female','general')),
  position INTEGER NOT NULL CHECK(typeof(position)='integer' AND position BETWEEN 1 AND 99),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 40),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 120),
  href TEXT CHECK(href IS NULL OR length(href) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK(typeof(updated_at)='integer' AND updated_at>=0),
  deleted_at INTEGER CHECK(deleted_at IS NULL OR (typeof(deleted_at)='integer' AND deleted_at>=created_at))
);
CREATE UNIQUE INDEX home_banners_live_slot ON home_banners(audience, position) WHERE deleted_at IS NULL;
CREATE INDEX home_banners_live_order ON home_banners(position DESC, id) WHERE deleted_at IS NULL;
