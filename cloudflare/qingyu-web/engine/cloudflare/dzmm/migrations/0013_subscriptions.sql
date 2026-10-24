-- Subscription rights and claimed credits are independent of prepaid recharge
-- and community rewards. All existing payment rows and sequences stay intact.
CREATE TABLE subscription_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL CHECK(plan_revision>0),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000),
  currency TEXT NOT NULL DEFAULT 'cny' CHECK(currency='cny'),
  duration_days INTEGER NOT NULL CHECK(duration_days=30),
  daily_credits INTEGER NOT NULL CHECK(daily_credits BETWEEN 1 AND 1000000),
  max_claims INTEGER NOT NULL CHECK(max_claims=30),
  timezone TEXT NOT NULL CHECK(timezone='Asia/Shanghai'),
  method TEXT NOT NULL CHECK(method IN ('alipay','wxpay')),
  out_trade_no TEXT NOT NULL UNIQUE CHECK(length(out_trade_no)=32 AND out_trade_no NOT GLOB '*[^0-9]*'),
  merchant_pid TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  payment_name TEXT NOT NULL,
  provider_trade_no TEXT UNIQUE,
  checkout_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','failed','refunded')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  UNIQUE(user_id,request_id),
  UNIQUE(id,user_id)
);
CREATE INDEX subscription_orders_owner ON subscription_orders(user_id,created_at DESC,id);

CREATE TABLE subscription_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('notify','query')),
  order_id TEXT NOT NULL REFERENCES subscription_orders(id) ON DELETE CASCADE,
  provider_trade_no TEXT NOT NULL,
  processing_token TEXT NOT NULL,
  verified_at INTEGER NOT NULL
);

CREATE TABLE subscription_periods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE,
  source_event_id TEXT NOT NULL REFERENCES subscription_events(event_id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at=starts_at+2592000000),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(order_id,user_id) REFERENCES subscription_orders(id,user_id) ON DELETE CASCADE,
  UNIQUE(id,user_id)
);
CREATE INDEX subscription_periods_owner ON subscription_periods(user_id,starts_at,expires_at);

CREATE TABLE subscription_daily_claims (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 1000000),
  claimed_at INTEGER NOT NULL CHECK(claimed_at>=0),
  processing_token TEXT NOT NULL,
  FOREIGN KEY(subscription_id,user_id) REFERENCES subscription_periods(id,user_id) ON DELETE CASCADE,
  UNIQUE(user_id,day_key),
  UNIQUE(user_id,request_id),
  UNIQUE(id,user_id),
  CHECK(day_key=strftime('%Y-%m-%d',claimed_at/1000,'unixepoch','+8 hours'))
);
CREATE INDEX subscription_claims_period ON subscription_daily_claims(subscription_id,claimed_at);

CREATE TABLE subscription_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind='daily_grant'),
  credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 1000000),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(claim_id,user_id) REFERENCES subscription_daily_claims(id,user_id) ON DELETE CASCADE
);
CREATE INDEX subscription_credit_balance ON subscription_credit_ledger(user_id);

-- One Z-Pay trade can fulfill exactly one intent across both business graphs.
-- Include unpaid historical orders so their later callbacks remain protected.
CREATE TABLE zpay_payment_bindings (
  out_trade_no TEXT PRIMARY KEY,
  merchant_pid TEXT NOT NULL,
  provider_trade_no TEXT UNIQUE,
  recharge_order_id TEXT UNIQUE REFERENCES zpay_orders(id) ON DELETE CASCADE,
  subscription_order_id TEXT UNIQUE REFERENCES subscription_orders(id) ON DELETE CASCADE,
  CHECK((recharge_order_id IS NOT NULL AND subscription_order_id IS NULL)
    OR (recharge_order_id IS NULL AND subscription_order_id IS NOT NULL))
);
INSERT INTO zpay_payment_bindings(out_trade_no,merchant_pid,provider_trade_no,recharge_order_id)
  SELECT out_trade_no,merchant_pid,provider_trade_no,id FROM zpay_orders;
