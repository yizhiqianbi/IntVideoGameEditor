-- Chat story images use the shared Credit wallet. Existing media receipts are
-- preserved and remain free historical rows; only new image reservations set
-- credits=100.
PRAGMA foreign_keys = OFF;

CREATE TABLE chat_media_usage_credit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('audio','image')),
  day_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0 CHECK(credits IN (0,100)),
  CHECK(day_key=strftime('%Y-%m-%d',created_at/1000,'unixepoch','+8 hours'))
);
INSERT INTO chat_media_usage_credit(id,user_id,asset_id,kind,day_key,status,created_at,expires_at,credits)
  SELECT id,user_id,asset_id,kind,day_key,status,created_at,expires_at,0 FROM chat_media_usage;
DROP TABLE chat_media_usage;
ALTER TABLE chat_media_usage_credit RENAME TO chat_media_usage;
CREATE INDEX chat_media_daily_usage ON chat_media_usage(user_id,day_key,kind,status);
CREATE INDEX chat_media_pending_expiry ON chat_media_usage(user_id,status,expires_at);

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
      UNION ALL SELECT credits FROM subscription_credit_ledger WHERE user_id=u.id
      UNION ALL SELECT credits FROM (
        SELECT credits FROM community_credit_ledger WHERE user_id=u.id
        UNION ALL SELECT credits FROM admin_credit_adjustments WHERE user_id=u.id
        UNION ALL SELECT credits FROM trusted_credit_grants WHERE user_id=u.id
      )
    )),0) AS granted_credits,
    -COALESCE((SELECT SUM(credits) FROM credit_usage_ledger WHERE user_id=u.id),0)
      -COALESCE((SELECT SUM(credits) FROM generation_credit_ledger WHERE user_id=u.id),0)
      +COALESCE((SELECT SUM(credits) FROM chat_media_usage WHERE user_id=u.id AND kind='image' AND status='ready'),0) AS total_spent,
    COALESCE((SELECT SUM(reserved_credits) FROM credit_usage_requests WHERE user_id=u.id AND status IN ('reserved','pending')
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(reserved_credits) FROM generation_jobs WHERE user_id=u.id AND finalized_at IS NULL
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(credits) FROM chat_media_usage WHERE user_id=u.id AND kind='image' AND status='pending'),0) AS reserved_credits
  FROM users u
);

PRAGMA foreign_keys = ON;
