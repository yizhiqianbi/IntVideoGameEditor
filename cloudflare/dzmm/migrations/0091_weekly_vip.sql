PRAGMA foreign_keys=OFF;
PRAGMA legacy_alter_table=ON;
DROP TRIGGER IF EXISTS subscription_periods_duration_insert;
DROP TRIGGER IF EXISTS subscription_periods_duration_update;
DROP TRIGGER IF EXISTS forum_demo_deny_subscription_orders_insert;
DROP TRIGGER IF EXISTS forum_demo_deny_subscription_orders_update;
ALTER TABLE subscription_orders RENAME TO subscription_orders_old;
ALTER TABLE subscription_periods RENAME TO subscription_periods_old;
CREATE TABLE subscription_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL CHECK(plan_revision>0),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
  currency TEXT NOT NULL DEFAULT 'cny' CHECK(currency IN ('cny','usdt')),
  duration_days INTEGER NOT NULL CHECK((duration_days=7 OR duration_days=30 OR (duration_days=90 AND provider='nowpayments'))),
  daily_credits INTEGER NOT NULL CHECK(daily_credits BETWEEN 1 AND 1000000),
  max_claims INTEGER NOT NULL CHECK(max_claims=duration_days),
  timezone TEXT NOT NULL CHECK(timezone='Asia/Shanghai'),
  method TEXT NOT NULL CHECK(method IN ('alipay','wxpay','usdt','wechat')),
  out_trade_no TEXT NOT NULL UNIQUE CHECK(length(out_trade_no)=32 AND out_trade_no NOT GLOB '*[^0-9]*'),
  merchant_pid TEXT,
  channel_id TEXT,
  payment_name TEXT NOT NULL,
  provider_trade_no TEXT UNIQUE,
  checkout_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','failed','refunded')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  provider TEXT NOT NULL DEFAULT 'zpay' CHECK(provider IN ('zpay','nowpayments','waffo')),
  amount_scale INTEGER NOT NULL DEFAULT 2 CHECK((currency='cny' AND amount_scale=2 AND provider='zpay' AND method IN ('alipay','wxpay') AND merchant_pid IS NOT NULL AND channel_id IS NOT NULL) OR (currency='usdt' AND amount_scale=6 AND provider='nowpayments' AND method='usdt' AND merchant_pid IS NULL AND channel_id IS NULL)
    OR (currency='cny' AND amount_scale=2 AND provider='waffo' AND method='wechat' AND merchant_pid IS NULL AND channel_id IS NULL)),
  UNIQUE(user_id,request_id),
  UNIQUE(id,user_id)
);
CREATE TABLE subscription_periods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE,
  source_event_id TEXT NOT NULL REFERENCES "subscription_events"(event_id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at IN (starts_at+604800000,starts_at+2592000000,starts_at+7776000000)),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(order_id,user_id) REFERENCES "subscription_orders"(id,user_id) ON DELETE CASCADE,
  UNIQUE(id,user_id)
);
INSERT INTO subscription_orders SELECT * FROM subscription_orders_old;
INSERT INTO subscription_periods SELECT * FROM subscription_periods_old;
DROP TABLE subscription_orders_old;
DROP TABLE subscription_periods_old;
CREATE INDEX subscription_orders_owner ON subscription_orders(user_id,created_at DESC,id);
CREATE INDEX subscription_periods_owner ON subscription_periods(user_id,starts_at,expires_at);
CREATE TRIGGER subscription_periods_duration_insert BEFORE INSERT ON subscription_periods
WHEN NEW.expires_at<>NEW.starts_at+COALESCE((SELECT duration_days FROM subscription_orders WHERE id=NEW.order_id),0)*86400000
BEGIN SELECT RAISE(ABORT,'Membership period must match its immutable order duration'); END;
CREATE TRIGGER subscription_periods_duration_update BEFORE UPDATE ON subscription_periods
WHEN NEW.expires_at<>NEW.starts_at+COALESCE((SELECT duration_days FROM subscription_orders WHERE id=NEW.order_id),0)*86400000
BEGIN SELECT RAISE(ABORT,'Membership period must match its immutable order duration'); END;
CREATE TRIGGER forum_demo_deny_subscription_orders_insert BEFORE INSERT ON subscription_orders
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;
CREATE TRIGGER forum_demo_deny_subscription_orders_update BEFORE UPDATE ON subscription_orders
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;
PRAGMA legacy_alter_table=OFF;
PRAGMA foreign_keys=ON;