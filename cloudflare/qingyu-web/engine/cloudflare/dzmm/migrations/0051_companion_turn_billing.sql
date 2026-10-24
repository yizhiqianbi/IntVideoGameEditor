-- Independent fixed-price companion turns. This migration does not enable
-- collection or modify ordinary chat rates, grants, purchases, or refunds.
CREATE TABLE companion_turn_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL CHECK(length(request_id)=36),
  session_id TEXT NOT NULL CHECK(length(session_id)=36),
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),
  price_revision INTEGER NOT NULL CHECK(price_revision=1),
  credits_per_message INTEGER NOT NULL CHECK(credits_per_message=2),
  reserved_credits INTEGER NOT NULL CHECK(reserved_credits=2),
  authorization_hash TEXT NOT NULL CHECK(length(authorization_hash)=64 AND authorization_hash NOT GLOB '*[^0-9a-f]*'),
  processing_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','settled','released')),
  charged_credits INTEGER NOT NULL DEFAULT 0 CHECK(charged_credits IN (0,2)),
  outcome TEXT CHECK(outcome IN ('completed','failed','expired')),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at=created_at+600000),
  finalized_at INTEGER CHECK(finalized_at>=created_at),
  UNIQUE(user_id,request_id),
  UNIQUE(id,user_id),
  CHECK((status='reserved' AND charged_credits=0 AND outcome IS NULL AND finalized_at IS NULL)
    OR (status='settled' AND charged_credits=2 AND outcome='completed' AND finalized_at IS NOT NULL)
    OR (status='released' AND charged_credits=0 AND outcome IN ('failed','expired') AND finalized_at IS NOT NULL))
);
CREATE INDEX companion_turn_owner ON companion_turn_requests(user_id,created_at DESC,id DESC);
CREATE INDEX companion_turn_active ON companion_turn_requests(expires_at,user_id) WHERE status='reserved';

-- Releasing a hold adds no Credit; exactly one terminal accounting fact exists.
CREATE TABLE companion_turn_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('charge','release')),
  credits INTEGER NOT NULL CHECK((kind='charge' AND credits=-2) OR (kind='release' AND credits=0)),
  outcome TEXT NOT NULL CHECK(outcome IN ('completed','failed','expired')),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  FOREIGN KEY(reservation_id,user_id) REFERENCES companion_turn_requests(id,user_id) ON DELETE CASCADE
);
CREATE INDEX companion_turn_balance ON companion_turn_ledger(user_id);

-- Preserve the complete 0050 wallet graph, adding only companion debits/holds.
DROP VIEW credit_usage_balances;
CREATE VIEW credit_usage_balances AS
SELECT user_id,granted_credits,total_spent,reserved_credits,
  MAX(0,granted_credits-total_spent-reserved_credits) AS balance,
  MAX(0,total_spent-granted_credits) AS debt_credits
FROM (
  SELECT u.id AS user_id,
    COALESCE((SELECT SUM(credits) FROM (
      SELECT l.credits FROM payment_credit_ledger l JOIN payment_orders o ON o.id=l.order_id WHERE l.user_id=u.id AND o.mode='live'
      UNION ALL SELECT l.credits FROM zpay_credit_ledger l JOIN zpay_orders o ON o.id=l.order_id WHERE l.user_id=u.id
      UNION ALL SELECT l.credits FROM guagua_credit_ledger l JOIN guagua_orders o ON o.id=l.order_id WHERE l.user_id=u.id
      UNION ALL SELECT credits FROM subscription_credit_ledger WHERE user_id=u.id
      UNION ALL SELECT credits FROM (
        SELECT credits FROM community_credit_ledger WHERE user_id=u.id
        UNION ALL SELECT credits FROM admin_credit_adjustments WHERE user_id=u.id
        UNION ALL SELECT credits FROM trusted_credit_grants WHERE user_id=u.id
        UNION ALL SELECT credits FROM dream_coin_exchanges WHERE user_id=u.id
      )
    )),0) AS granted_credits,
    -COALESCE((SELECT SUM(credits) FROM credit_usage_ledger WHERE user_id=u.id),0)
      -COALESCE((SELECT SUM(credits) FROM generation_credit_ledger WHERE user_id=u.id),0)
      +COALESCE((SELECT SUM(credits) FROM chat_media_usage WHERE user_id=u.id AND kind='image' AND status='ready'),0)
      -COALESCE((SELECT SUM(credits) FROM companion_turn_ledger WHERE user_id=u.id),0) AS total_spent,
    COALESCE((SELECT SUM(reserved_credits) FROM credit_usage_requests WHERE user_id=u.id AND status IN ('reserved','pending')
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(reserved_credits) FROM generation_jobs WHERE user_id=u.id AND finalized_at IS NULL
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(credits) FROM chat_media_usage WHERE user_id=u.id AND kind='image' AND status='pending'),0)
      +COALESCE((SELECT SUM(reserved_credits) FROM companion_turn_requests WHERE user_id=u.id AND status='reserved'
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0) AS reserved_credits
  FROM users u
);
