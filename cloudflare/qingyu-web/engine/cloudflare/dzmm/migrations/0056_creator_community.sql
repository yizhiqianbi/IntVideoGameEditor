-- Qingyu creator community foundation.
--
-- These tables intentionally stay separate from the legacy subscription/payment
-- tables.  The first release only exposes free profiles, posts, follows and
-- subscription reminder intents.  No table here creates an order, charges a
-- balance, or stores a crypto payment reference.
PRAGMA foreign_keys = ON;

CREATE TABLE creator_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 2000),
  avatar_url TEXT NOT NULL DEFAULT '' CHECK (length(avatar_url) <= 2048),
  cover_url TEXT NOT NULL DEFAULT '' CHECK (length(cover_url) <= 2048),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  review_reason TEXT NOT NULL DEFAULT '' CHECK (length(review_reason) <= 2000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX creator_profiles_public ON creator_profiles(status, updated_at DESC, id);
CREATE INDEX creator_profiles_user ON creator_profiles(user_id);

CREATE TABLE creator_posts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  character_publication_id TEXT,
  post_type TEXT NOT NULL DEFAULT 'text' CHECK (post_type IN ('text', 'image', 'roleplay', 'adventure', 'video_preview', 'voice_preview')),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 12000),
  media_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(media_json) AND json_type(media_json) = 'array'),
  visibility TEXT NOT NULL DEFAULT 'free' CHECK (visibility IN ('free', 'subscriber')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'hidden')),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  review_reason TEXT NOT NULL DEFAULT '' CHECK (length(review_reason) <= 2000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX creator_posts_public ON creator_posts(status, visibility, created_at DESC, id);
CREATE INDEX creator_posts_creator ON creator_posts(creator_id, status, pinned DESC, created_at DESC, id);

CREATE TABLE creator_post_media (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES creator_posts(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL CHECK (length(r2_key) BETWEEN 1 AND 512),
  mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 120),
  bytes INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE (post_id, position)
);
CREATE INDEX creator_post_media_post ON creator_post_media(post_id, position);

CREATE TABLE creator_post_likes (
  post_id TEXT NOT NULL REFERENCES creator_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX creator_post_likes_count ON creator_post_likes(post_id, created_at DESC);

CREATE TABLE creator_post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES creator_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'removed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX creator_post_comments_post ON creator_post_comments(post_id, status, created_at ASC, id);

CREATE TABLE creator_follows (
  creator_id TEXT NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (creator_id, user_id)
);
CREATE INDEX creator_follows_user ON creator_follows(user_id, created_at DESC, creator_id);
CREATE INDEX creator_follows_creator ON creator_follows(creator_id, created_at DESC, user_id);

CREATE TABLE creator_subscription_intents (
  creator_id TEXT NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (creator_id, user_id)
);
CREATE INDEX creator_subscription_intents_user ON creator_subscription_intents(user_id, updated_at DESC);

-- Future subscription permissions.  Rows are inert until a payment provider
-- and an explicit activation workflow are introduced.
CREATE TABLE creator_subscriptions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  period_start INTEGER,
  period_end INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (creator_id, user_id)
);
CREATE INDEX creator_subscriptions_user ON creator_subscriptions(user_id, status, period_end);
CREATE INDEX creator_subscriptions_creator ON creator_subscriptions(creator_id, status, period_end);

CREATE TABLE creator_content_access (
  post_id TEXT NOT NULL REFERENCES creator_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('subscription', 'grant')),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE creator_direct_messages (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 12000),
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'subscriber', 'pending', 'hidden')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX creator_direct_messages_thread ON creator_direct_messages(creator_id, user_id, created_at ASC, id);

CREATE TABLE creator_paid_messages (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE REFERENCES creator_direct_messages(id) ON DELETE CASCADE,
  price_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) BETWEEN 3 AND 12),
  order_ref TEXT,
  status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled', 'pending', 'paid', 'refunded', 'cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE creator_live_rooms (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  character_publication_id TEXT,
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 160),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'live', 'ended', 'cancelled')),
  scheduled_at INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  provider_room_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX creator_live_rooms_public ON creator_live_rooms(status, scheduled_at, creator_id);

CREATE TABLE creator_videos (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES creator_posts(id) ON DELETE SET NULL,
  r2_key TEXT,
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 160),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'hidden')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX creator_videos_public ON creator_videos(status, created_at DESC, creator_id);

CREATE TABLE creator_payouts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  gross_minor INTEGER NOT NULL DEFAULT 0 CHECK (gross_minor >= 0),
  platform_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (platform_fee_minor >= 0),
  net_minor INTEGER NOT NULL DEFAULT 0 CHECK (net_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) BETWEEN 3 AND 12),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'paid', 'cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX creator_payouts_creator ON creator_payouts(creator_id, period_end DESC, status);
