PRAGMA foreign_keys=OFF;
PRAGMA legacy_alter_table=ON;
DROP VIEW credit_usage_balances;
ALTER TABLE guagua_orders RENAME TO guagua_orders_old;
CREATE TABLE guagua_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  package_id TEXT NOT NULL CHECK(package_id IN ('cny_28','cny_88','cny_188','cny_custom')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 100 AND 200000 AND amount_minor % 100 = 0),
  currency TEXT NOT NULL DEFAULT 'cny' CHECK(currency='cny'),
  credits INTEGER NOT NULL CHECK(
    (promotion IS NULL AND (
      (package_id='cny_custom' AND credits=amount_minor)
      OR (package_id='cny_28' AND credits=amount_minor)
      OR (package_id='cny_88' AND credits IN (8800, 10000))
      OR (package_id='cny_188' AND credits IN (18800, 30000))
    ))
    OR (promotion='first_half' AND (
      (package_id='cny_28' AND credits=2800)
      OR (package_id='cny_88' AND credits IN (8800, 10000))
      OR (package_id='cny_188' AND credits IN (18800, 30000))
    ))
  ),
  method TEXT NOT NULL CHECK(method='wxpay'),
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
  promotion TEXT,
  UNIQUE(user_id,request_id),
  CHECK(
    (package_id='cny_custom')
    OR (package_id='cny_28' AND (amount_minor=2800 OR (promotion='first_half' AND amount_minor=1400)))
    OR (package_id='cny_88' AND (amount_minor=8800 OR (promotion='first_half' AND amount_minor=4400)))
    OR (package_id='cny_188' AND (amount_minor=18800 OR (promotion='first_half' AND amount_minor=9400)))
  ),
  CHECK(paid_at IS NULL OR status='paid')
);
INSERT INTO guagua_orders (id,user_id,request_id,package_id,amount_minor,currency,credits,method,mer_order_tid,merchant_mid,channel_code,provider_trade_no,pay_url,checkout_url,status,refunded_amount_minor,refunded_credits,created_at,updated_at,paid_at,promotion)
SELECT id,user_id,request_id,package_id,amount_minor,currency,credits,method,mer_order_tid,merchant_mid,channel_code,provider_trade_no,pay_url,checkout_url,status,refunded_amount_minor,refunded_credits,created_at,updated_at,paid_at,promotion FROM guagua_orders_old;
DROP TABLE guagua_orders_old;
CREATE INDEX guagua_orders_owner ON guagua_orders(user_id,created_at DESC,id);
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
      +COALESCE((SELECT SUM(credits) FROM canvas_generation_charges WHERE user_id=u.id AND status='charged'),0)
      +COALESCE((SELECT SUM(credits) FROM call_charges WHERE user_id=u.id AND status='charged'),0)
      +COALESCE((SELECT SUM(credits) FROM video_episode_unlocks WHERE user_id=u.id),0) AS total_spent,
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
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(credits) FROM call_charges WHERE user_id=u.id AND status='reserved'
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0) AS reserved_credits
  FROM users u
);
PRAGMA legacy_alter_table=OFF;
PRAGMA foreign_keys=ON;
