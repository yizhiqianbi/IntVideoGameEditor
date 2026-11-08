-- Guagua (瓜瓜) live CNY purchases. Existing Stripe, Z-Pay and subscription
-- ledgers stay in place; this graph only adds the new channel.
CREATE TABLE guagua_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  package_id TEXT NOT NULL CHECK(package_id IN ('cny_28','cny_88','cny_188')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor IN (2800,8800,18800)),
  currency TEXT NOT NULL DEFAULT 'cny' CHECK(currency='cny'),
  credits INTEGER NOT NULL CHECK(credits=amount_minor),
  method TEXT NOT NULL CHECK(method='alipay'),
  mer_order_tid TEXT NOT NULL UNIQUE CHECK(length(mer_order_tid) BETWEEN 8 AND 30 AND mer_order_tid NOT GLOB '*[^A-Za-z0-9_-]*'),
  merchant_mid TEXT NOT NULL,
  channel_code TEXT NOT NULL,
  provider_trade_no TEXT UNIQUE,
  pay_url TEXT,
  checkout_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','failed')),
  refunded_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(refunded_amount_minor=0),
  refunded_credits INTEGER NOT NULL DEFAULT 0 CHECK(refunded_credits=0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  UNIQUE(user_id,request_id),
  CHECK((package_id='cny_28' AND amount_minor=2800) OR (package_id='cny_88' AND amount_minor=8800) OR (package_id='cny_188' AND amount_minor=18800)),
  CHECK(paid_at IS NULL OR status='paid')
);
CREATE INDEX guagua_orders_owner ON guagua_orders(user_id,created_at DESC,id);

CREATE TABLE guagua_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('notify','query')),
  order_id TEXT NOT NULL REFERENCES guagua_orders(id) ON DELETE CASCADE,
  provider_trade_no TEXT NOT NULL,
  processing_token TEXT NOT NULL,
  verified_at INTEGER NOT NULL
);

CREATE TABLE guagua_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES guagua_orders(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL REFERENCES guagua_events(event_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind='purchase'),
  credits INTEGER NOT NULL CHECK(credits>0),
  created_at INTEGER NOT NULL,
  UNIQUE(order_id,source_event_id,kind)
);
CREATE UNIQUE INDEX guagua_purchase_once ON guagua_credit_ledger(order_id);
CREATE INDEX guagua_credit_balance ON guagua_credit_ledger(user_id);

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
