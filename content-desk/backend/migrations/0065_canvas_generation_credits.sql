-- Canvas image is 20 Credit (2 毛). Canvas video is 10 Credit per billed second (1 毛).
-- The current H3 clip is 122 frames at 24 fps, billed as 5 seconds = 50 Credit.
CREATE TABLE canvas_generation_charges (
  id TEXT PRIMARY KEY CHECK(length(id)=36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL CHECK(length(request_id)=36),
  kind TEXT NOT NULL CHECK(kind IN ('image','video')),
  seconds INTEGER NOT NULL CHECK((kind='image' AND seconds=0) OR (kind='video' AND seconds BETWEEN 1 AND 60)),
  claim_hash TEXT NOT NULL CHECK(length(claim_hash)=64),
  status TEXT NOT NULL CHECK(status IN ('reserved','charged','released')),
  credits INTEGER NOT NULL CHECK((kind='image' AND credits=20) OR (kind='video' AND credits=seconds*10)),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
  finalized_at INTEGER CHECK(finalized_at IS NULL OR finalized_at>=created_at),
  UNIQUE(user_id, request_id),
  CHECK((status='reserved' AND finalized_at IS NULL) OR (status IN ('charged','released') AND finalized_at IS NOT NULL))
);
CREATE INDEX canvas_generation_charges_owner ON canvas_generation_charges(user_id, status, expires_at);

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
      +COALESCE((SELECT SUM(credits) FROM chat_media_usage WHERE user_id=u.id AND status='ready'),0)
      -COALESCE((SELECT SUM(credits) FROM companion_turn_ledger WHERE user_id=u.id),0)
      +COALESCE((SELECT SUM(credits) FROM studio_still_charges WHERE user_id=u.id AND status='charged'),0)
      +COALESCE((SELECT SUM(credits) FROM canvas_generation_charges WHERE user_id=u.id AND status='charged'),0) AS total_spent,
    COALESCE((SELECT SUM(reserved_credits) FROM credit_usage_requests WHERE user_id=u.id AND status IN ('reserved','pending')
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(reserved_credits) FROM generation_jobs WHERE user_id=u.id AND finalized_at IS NULL
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(credits) FROM chat_media_usage WHERE user_id=u.id AND status='pending'),0)
      +COALESCE((SELECT SUM(reserved_credits) FROM companion_turn_requests WHERE user_id=u.id AND status='reserved'
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(credits) FROM studio_still_charges WHERE user_id=u.id AND status='reserved'
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(credits) FROM canvas_generation_charges WHERE user_id=u.id AND status='reserved'
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0) AS reserved_credits
  FROM users u
);
