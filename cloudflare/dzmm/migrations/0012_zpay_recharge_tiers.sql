-- Expand the allowed catalogue without repricing historical orders. Rebuild
-- the whole graph with foreign keys enforced so old events, refunds and credits
-- retain their identities and the prices frozen when each order was created.
CREATE TABLE zpay_orders_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  package_id TEXT NOT NULL CHECK(package_id IN ('cny_1','cny_5','cny_10','cny_28','cny_88','cny_188')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor IN (100,500,1000,2800,8800,18800)),
  currency TEXT NOT NULL DEFAULT 'cny' CHECK(currency='cny'),
  credits INTEGER NOT NULL CHECK(credits=amount_minor),
  method TEXT NOT NULL CHECK(method IN ('alipay','wxpay')),
  out_trade_no TEXT NOT NULL UNIQUE CHECK(length(out_trade_no)=32 AND out_trade_no NOT GLOB '*[^0-9]*'),
  merchant_pid TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  payment_name TEXT NOT NULL,
  provider_trade_no TEXT UNIQUE,
  checkout_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','partially_refunded','refunded','expired','failed')),
  refunded_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(refunded_amount_minor>=0 AND refunded_amount_minor<=amount_minor),
  refunded_credits INTEGER NOT NULL DEFAULT 0 CHECK(refunded_credits>=0 AND refunded_credits<=credits),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  UNIQUE(user_id,request_id),
  CHECK((package_id='cny_1' AND amount_minor=100) OR (package_id='cny_5' AND amount_minor=500) OR (package_id='cny_10' AND amount_minor=1000)
    OR (package_id='cny_28' AND amount_minor=2800) OR (package_id='cny_88' AND amount_minor=8800) OR (package_id='cny_188' AND amount_minor=18800))
);
INSERT INTO zpay_orders_next SELECT * FROM zpay_orders;

CREATE TABLE zpay_events_next (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('notify','query','manual_refund')),
  order_id TEXT NOT NULL REFERENCES zpay_orders_next(id) ON DELETE CASCADE,
  provider_trade_no TEXT NOT NULL,
  processing_token TEXT NOT NULL,
  verified_at INTEGER NOT NULL
);
INSERT INTO zpay_events_next SELECT * FROM zpay_events;

CREATE TABLE zpay_refund_state_next (
  refund_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES zpay_orders_next(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  status TEXT NOT NULL CHECK(status IN ('requested','manual_review','confirmed','failed')),
  verification_reference TEXT,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(status<>'confirmed' OR (verified_at IS NOT NULL AND verification_reference IS NOT NULL AND length(verification_reference)>0))
);
INSERT INTO zpay_refund_state_next SELECT * FROM zpay_refund_state;

CREATE TABLE zpay_credit_ledger_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES zpay_orders_next(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL REFERENCES zpay_events_next(event_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('purchase','refund_adjustment')),
  credits INTEGER NOT NULL CHECK(credits<>0 AND (kind<>'purchase' OR credits>0)),
  created_at INTEGER NOT NULL,
  UNIQUE(order_id,source_event_id,kind)
);
INSERT INTO zpay_credit_ledger_next SELECT * FROM zpay_credit_ledger;
-- Preserve deleted-row high-water marks. An unused ledger has no sequence row;
-- copying its empty contents must not introduce a new sequence value of zero.
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='zpay_credit_ledger'),0))
  WHERE name='zpay_credit_ledger_next';
INSERT INTO sqlite_sequence(name,seq)
  SELECT 'zpay_credit_ledger_next',seq FROM sqlite_sequence WHERE name='zpay_credit_ledger'
  AND NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='zpay_credit_ledger_next');
DELETE FROM sqlite_sequence WHERE name='zpay_credit_ledger_next'
  AND NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='zpay_credit_ledger');

DROP TABLE zpay_credit_ledger;
DROP TABLE zpay_refund_state;
DROP TABLE zpay_events;
DROP TABLE zpay_orders;
ALTER TABLE zpay_orders_next RENAME TO zpay_orders;
ALTER TABLE zpay_events_next RENAME TO zpay_events;
ALTER TABLE zpay_refund_state_next RENAME TO zpay_refund_state;
ALTER TABLE zpay_credit_ledger_next RENAME TO zpay_credit_ledger;

CREATE INDEX zpay_orders_owner ON zpay_orders(user_id,created_at DESC,id);
CREATE UNIQUE INDEX zpay_purchase_once ON zpay_credit_ledger(order_id) WHERE kind='purchase';
CREATE INDEX zpay_credit_balance ON zpay_credit_ledger(user_id,kind);
