-- Multi-tier VIP monthly plans and prorated trade-in upgrade tracking.
-- Also rebuilds child tables referencing subscription_orders / subscription_periods
-- so any dangling *_old FK references left by 0091_weekly_vip.sql under SQLite's
-- default legacy_alter_table=OFF are cleanly repaired on both fresh and live D1 DBs.

PRAGMA defer_foreign_keys = ON;

ALTER TABLE subscription_orders ADD COLUMN upgrade_from_subscription_id TEXT;
ALTER TABLE subscription_orders ADD COLUMN list_amount_minor INTEGER;
ALTER TABLE subscription_orders ADD COLUMN trade_in_minor INTEGER NOT NULL DEFAULT 0;

CREATE TABLE subscription_events_next (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('notify','query')),
  order_id TEXT NOT NULL REFERENCES subscription_orders(id) ON DELETE CASCADE,
  provider_trade_no TEXT NOT NULL,
  processing_token TEXT NOT NULL,
  verified_at INTEGER NOT NULL
);
INSERT INTO subscription_events_next(event_id,event_type,order_id,provider_trade_no,processing_token,verified_at)
  SELECT event_id,event_type,order_id,provider_trade_no,processing_token,verified_at FROM subscription_events;

CREATE TABLE subscription_periods_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE,
  source_event_id TEXT NOT NULL REFERENCES subscription_events_next(event_id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at IN (starts_at+604800000,starts_at+2592000000,starts_at+7776000000)),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  upgraded_to_order_id TEXT,
  FOREIGN KEY(order_id,user_id) REFERENCES subscription_orders(id,user_id) ON DELETE CASCADE,
  UNIQUE(id,user_id)
);
INSERT INTO subscription_periods_next(id,user_id,order_id,source_event_id,starts_at,expires_at,revoked_at,created_at,upgraded_to_order_id)
  SELECT id,user_id,order_id,source_event_id,starts_at,expires_at,revoked_at,created_at,NULL FROM subscription_periods;

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
INSERT INTO subscription_daily_claims_next(id,user_id,subscription_id,request_id,day_key,credits,claimed_at,processing_token)
  SELECT id,user_id,subscription_id,request_id,day_key,credits,claimed_at,processing_token FROM subscription_daily_claims;

CREATE TABLE subscription_credit_ledger_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind='daily_grant'),
  credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 1000000),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(claim_id,user_id) REFERENCES subscription_daily_claims_next(id,user_id) ON DELETE CASCADE
);
INSERT INTO subscription_credit_ledger_next(id,user_id,claim_id,kind,credits,created_at)
  SELECT id,user_id,claim_id,kind,credits,created_at FROM subscription_credit_ledger;

UPDATE sqlite_sequence
  SET seq=MAX(seq,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='subscription_credit_ledger'),0))
  WHERE name='subscription_credit_ledger_next';
INSERT INTO sqlite_sequence(name,seq)
  SELECT 'subscription_credit_ledger_next',seq FROM sqlite_sequence
  WHERE name='subscription_credit_ledger'
    AND NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='subscription_credit_ledger_next');

CREATE TABLE zpay_payment_bindings_next (
  out_trade_no TEXT PRIMARY KEY,
  merchant_pid TEXT NOT NULL,
  provider_trade_no TEXT UNIQUE,
  recharge_order_id TEXT UNIQUE REFERENCES zpay_orders(id) ON DELETE CASCADE,
  subscription_order_id TEXT UNIQUE REFERENCES subscription_orders(id) ON DELETE CASCADE,
  CHECK((recharge_order_id IS NOT NULL AND subscription_order_id IS NULL)
    OR (recharge_order_id IS NULL AND subscription_order_id IS NOT NULL))
);
INSERT INTO zpay_payment_bindings_next(out_trade_no,merchant_pid,provider_trade_no,recharge_order_id,subscription_order_id)
  SELECT out_trade_no,merchant_pid,provider_trade_no,recharge_order_id,subscription_order_id FROM zpay_payment_bindings;

CREATE TABLE nowpayments_invoices_next (
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
INSERT INTO nowpayments_invoices_next(order_id,invoice_id,payment_id,pay_currency,creation_state,creation_token,provider_status,pay_address,pay_amount,actually_paid,outcome_amount,outcome_currency,created_at,updated_at)
  SELECT order_id,invoice_id,payment_id,pay_currency,creation_state,creation_token,provider_status,pay_address,pay_amount,actually_paid,outcome_amount,outcome_currency,created_at,updated_at FROM nowpayments_invoices;

CREATE TABLE nowpayments_payment_bindings_next (
  payment_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES subscription_orders(id) ON DELETE CASCADE,
  verified_at INTEGER NOT NULL
);
INSERT INTO nowpayments_payment_bindings_next(payment_id,order_id,verified_at)
  SELECT payment_id,order_id,verified_at FROM nowpayments_payment_bindings;

CREATE TABLE guagua_vip_orders_next (
  subscription_order_id TEXT PRIMARY KEY REFERENCES subscription_orders(id) ON DELETE CASCADE,
  mer_order_tid TEXT NOT NULL UNIQUE CHECK(length(mer_order_tid) BETWEEN 8 AND 30 AND mer_order_tid NOT GLOB '*[^A-Za-z0-9_-]*'),
  merchant_mid TEXT NOT NULL,
  channel_code TEXT NOT NULL,
  pay_url TEXT,
  provider_trade_no TEXT UNIQUE
);
INSERT INTO guagua_vip_orders_next(subscription_order_id,mer_order_tid,merchant_mid,channel_code,pay_url,provider_trade_no)
  SELECT subscription_order_id,mer_order_tid,merchant_mid,channel_code,pay_url,provider_trade_no FROM guagua_vip_orders;

DROP VIEW credit_usage_balances;
DROP TRIGGER IF EXISTS subscription_periods_duration_insert;
DROP TRIGGER IF EXISTS subscription_periods_duration_update;
DROP TRIGGER IF EXISTS forum_demo_deny_subscription_credit_ledger_insert;
DROP TRIGGER IF EXISTS forum_demo_deny_subscription_credit_ledger_update;

DROP TABLE subscription_credit_ledger;
DROP TABLE subscription_daily_claims;
DROP TABLE subscription_periods;
DROP TABLE subscription_events;
DROP TABLE zpay_payment_bindings;
DROP TABLE nowpayments_payment_bindings;
DROP TABLE nowpayments_invoices;
DROP TABLE guagua_vip_orders;

ALTER TABLE subscription_events_next RENAME TO subscription_events;
ALTER TABLE subscription_periods_next RENAME TO subscription_periods;
ALTER TABLE subscription_daily_claims_next RENAME TO subscription_daily_claims;
ALTER TABLE subscription_credit_ledger_next RENAME TO subscription_credit_ledger;
ALTER TABLE zpay_payment_bindings_next RENAME TO zpay_payment_bindings;
ALTER TABLE nowpayments_invoices_next RENAME TO nowpayments_invoices;
ALTER TABLE nowpayments_payment_bindings_next RENAME TO nowpayments_payment_bindings;
ALTER TABLE guagua_vip_orders_next RENAME TO guagua_vip_orders;

CREATE INDEX subscription_periods_owner ON subscription_periods(user_id,starts_at,expires_at);
CREATE INDEX subscription_claims_period ON subscription_daily_claims(subscription_id,claimed_at);
CREATE INDEX subscription_credit_balance ON subscription_credit_ledger(user_id);

CREATE TRIGGER subscription_periods_duration_insert BEFORE INSERT ON subscription_periods
WHEN NEW.expires_at<>NEW.starts_at+COALESCE((SELECT duration_days FROM subscription_orders WHERE id=NEW.order_id),0)*86400000
BEGIN SELECT RAISE(ABORT,'Membership period must match its immutable order duration'); END;

CREATE TRIGGER subscription_periods_duration_update BEFORE UPDATE ON subscription_periods
WHEN NEW.expires_at<>NEW.starts_at+COALESCE((SELECT duration_days FROM subscription_orders WHERE id=NEW.order_id),0)*86400000
BEGIN SELECT RAISE(ABORT,'Membership period must match its immutable order duration'); END;

CREATE TRIGGER forum_demo_deny_subscription_credit_ledger_insert BEFORE INSERT ON subscription_credit_ledger
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_subscription_credit_ledger_update BEFORE UPDATE ON subscription_credit_ledger
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

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
