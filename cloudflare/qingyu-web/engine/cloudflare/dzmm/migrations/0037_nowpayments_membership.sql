-- Preserve the complete historical subscription/Zpay graph with enforced FKs.
-- Extend only order provider/currency precision for separate NOWPayments receipts.
-- No old price, entitlement, balance, ledger identity or sequence is changed.
DROP VIEW credit_usage_balances;

CREATE TABLE subscription_orders_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL CHECK(plan_revision>0),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
  currency TEXT NOT NULL DEFAULT 'cny' CHECK(currency IN ('cny','usdt')),
  duration_days INTEGER NOT NULL CHECK(duration_days=30),
  daily_credits INTEGER NOT NULL CHECK(daily_credits BETWEEN 1 AND 1000000),
  max_claims INTEGER NOT NULL CHECK(max_claims=30),
  timezone TEXT NOT NULL CHECK(timezone='Asia/Shanghai'),
  method TEXT NOT NULL CHECK(method IN ('alipay','wxpay','usdt')),
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
  provider TEXT NOT NULL DEFAULT 'zpay' CHECK(provider IN ('zpay','nowpayments')),
  amount_scale INTEGER NOT NULL DEFAULT 2 CHECK((currency='cny' AND amount_scale=2 AND provider='zpay' AND method IN ('alipay','wxpay') AND merchant_pid IS NOT NULL AND channel_id IS NOT NULL) OR (currency='usdt' AND amount_scale=6 AND provider='nowpayments' AND method='usdt' AND merchant_pid IS NULL AND channel_id IS NULL)),
  UNIQUE(user_id,request_id),
  UNIQUE(id,user_id)
);

INSERT INTO subscription_orders_next(id,user_id,request_id,plan_id,plan_revision,label,amount_minor,currency,duration_days,daily_credits,max_claims,timezone,method,out_trade_no,merchant_pid,channel_id,payment_name,provider_trade_no,checkout_url,status,created_at,updated_at,paid_at,provider,amount_scale) SELECT *, 'zpay',2 FROM subscription_orders;

CREATE TABLE subscription_events_next (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('notify','query')),
  order_id TEXT NOT NULL REFERENCES subscription_orders_next(id) ON DELETE CASCADE,
  provider_trade_no TEXT NOT NULL,
  processing_token TEXT NOT NULL,
  verified_at INTEGER NOT NULL
);

INSERT INTO subscription_events_next SELECT * FROM subscription_events;

CREATE TABLE subscription_periods_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE,
  source_event_id TEXT NOT NULL REFERENCES subscription_events_next(event_id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at=starts_at+2592000000),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(order_id,user_id) REFERENCES subscription_orders_next(id,user_id) ON DELETE CASCADE,
  UNIQUE(id,user_id)
);

INSERT INTO subscription_periods_next SELECT * FROM subscription_periods;

CREATE TABLE subscription_daily_claims_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 1000000),
  claimed_at INTEGER NOT NULL CHECK(claimed_at>=0),
  processing_token TEXT NOT NULL,
  FOREIGN KEY(subscription_id,user_id) REFERENCES subscription_periods_next(id,user_id) ON DELETE CASCADE,
  UNIQUE(user_id,day_key),
  UNIQUE(user_id,request_id),
  UNIQUE(id,user_id),
  CHECK(day_key=strftime('%Y-%m-%d',claimed_at/1000,'unixepoch','+8 hours'))
);

INSERT INTO subscription_daily_claims_next SELECT * FROM subscription_daily_claims;

CREATE TABLE subscription_credit_ledger_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind='daily_grant'),
  credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 1000000),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(claim_id,user_id) REFERENCES subscription_daily_claims_next(id,user_id) ON DELETE CASCADE
);

INSERT INTO subscription_credit_ledger_next SELECT * FROM subscription_credit_ledger;

CREATE TABLE zpay_payment_bindings_next (
  out_trade_no TEXT PRIMARY KEY,
  merchant_pid TEXT NOT NULL,
  provider_trade_no TEXT UNIQUE,
  recharge_order_id TEXT UNIQUE REFERENCES zpay_orders(id) ON DELETE CASCADE,
  subscription_order_id TEXT UNIQUE REFERENCES subscription_orders_next(id) ON DELETE CASCADE,
  CHECK((recharge_order_id IS NOT NULL AND subscription_order_id IS NULL)
    OR (recharge_order_id IS NULL AND subscription_order_id IS NOT NULL))
);

INSERT INTO zpay_payment_bindings_next SELECT * FROM zpay_payment_bindings;

UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='subscription_credit_ledger'),0)) WHERE name='subscription_credit_ledger_next';
INSERT INTO sqlite_sequence(name,seq) SELECT 'subscription_credit_ledger_next',seq FROM sqlite_sequence WHERE name='subscription_credit_ledger' AND NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='subscription_credit_ledger_next');

DROP TABLE subscription_credit_ledger;

DROP TABLE subscription_daily_claims;

DROP TABLE subscription_periods;

DROP TABLE subscription_events;

DROP TABLE zpay_payment_bindings;

DROP TABLE subscription_orders;

ALTER TABLE subscription_orders_next RENAME TO subscription_orders;

ALTER TABLE subscription_events_next RENAME TO subscription_events;

ALTER TABLE subscription_periods_next RENAME TO subscription_periods;

ALTER TABLE subscription_daily_claims_next RENAME TO subscription_daily_claims;

ALTER TABLE subscription_credit_ledger_next RENAME TO subscription_credit_ledger;

ALTER TABLE zpay_payment_bindings_next RENAME TO zpay_payment_bindings;

CREATE INDEX subscription_orders_owner ON subscription_orders(user_id,created_at DESC,id);
CREATE INDEX subscription_periods_owner ON subscription_periods(user_id,starts_at,expires_at);
CREATE INDEX subscription_claims_period ON subscription_daily_claims(subscription_id,claimed_at);
CREATE INDEX subscription_credit_balance ON subscription_credit_ledger(user_id);

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
      UNION ALL SELECT credits FROM admin_credit_adjustments WHERE user_id=u.id
      UNION ALL SELECT credits FROM trusted_credit_grants WHERE user_id=u.id
    )),0) AS granted_credits,
    -COALESCE((SELECT SUM(credits) FROM credit_usage_ledger WHERE user_id=u.id),0)
      -COALESCE((SELECT SUM(credits) FROM generation_credit_ledger WHERE user_id=u.id),0) AS total_spent,
    COALESCE((SELECT SUM(reserved_credits) FROM credit_usage_requests WHERE user_id=u.id AND status IN ('reserved','pending')
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(reserved_credits) FROM generation_jobs WHERE user_id=u.id AND finalized_at IS NULL
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0) AS reserved_credits
  FROM users u
);

CREATE TRIGGER forum_demo_deny_subscription_orders_insert BEFORE INSERT ON subscription_orders
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_subscription_orders_update BEFORE UPDATE ON subscription_orders
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_subscription_credit_ledger_insert BEFORE INSERT ON subscription_credit_ledger
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_subscription_credit_ledger_update BEFORE UPDATE ON subscription_credit_ledger
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;


-- Provider invoice creation claims are durable. Unknown outcomes are never
-- automatically recreated: an authenticated payment query/IPN can recover them.
CREATE TABLE nowpayments_invoices (
  order_id TEXT PRIMARY KEY REFERENCES subscription_orders(id) ON DELETE CASCADE,
  invoice_id TEXT UNIQUE,
  payment_id TEXT UNIQUE,
  pay_currency TEXT NOT NULL CHECK(pay_currency IN ('usdttrc20','usdterc20','usdtbsc','usdtmatic','usdtsol')),
  creation_state TEXT NOT NULL CHECK(creation_state IN ('creating','unknown','ready','rejected')),
  creation_token TEXT NOT NULL,
  provider_status TEXT,
  pay_address TEXT,
  pay_amount TEXT,
  actually_paid TEXT,
  outcome_amount TEXT,
  outcome_currency TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE nowpayments_payment_bindings (
  payment_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES subscription_orders(id) ON DELETE CASCADE,
  verified_at INTEGER NOT NULL
);
