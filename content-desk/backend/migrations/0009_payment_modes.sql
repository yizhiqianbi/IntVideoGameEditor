-- Rebuild the entire payment graph while foreign keys remain enforced. Dropping
-- only the old orders table would cascade-delete its events, refunds and credits.
-- All existing rows retain their identities and remain explicitly in test mode.
CREATE TABLE payment_orders_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  package_id TEXT NOT NULL CHECK(package_id IN ('usd_1','usd_5','usd_10')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor IN (100,500,1000)),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK(currency='usd'),
  credits INTEGER NOT NULL CHECK(credits=amount_minor),
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','partially_refunded','refunded','expired','failed')),
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  checkout_url TEXT,
  refunded_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(refunded_amount_minor>=0 AND refunded_amount_minor<=amount_minor),
  refunded_credits INTEGER NOT NULL DEFAULT 0 CHECK(refunded_credits>=0 AND refunded_credits<=credits),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  UNIQUE(user_id,mode,request_id),
  UNIQUE(mode,stripe_session_id),
  UNIQUE(mode,stripe_payment_intent_id),
  CHECK((package_id='usd_1' AND amount_minor=100) OR (package_id='usd_5' AND amount_minor=500) OR (package_id='usd_10' AND amount_minor=1000))
);
INSERT INTO payment_orders_next SELECT * FROM payment_orders;

CREATE TABLE payment_events_next (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES payment_orders_next(id) ON DELETE CASCADE,
  processing_token TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
INSERT INTO payment_events_next SELECT * FROM payment_events;

CREATE TABLE payment_refunds_next (
  refund_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES payment_orders_next(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  currency TEXT NOT NULL CHECK(currency='usd'),
  succeeded_seen INTEGER NOT NULL DEFAULT 0 CHECK(succeeded_seen IN (0,1)),
  failed_seen INTEGER NOT NULL DEFAULT 0 CHECK(failed_seen IN (0,1)),
  updated_at INTEGER NOT NULL
);
INSERT INTO payment_refunds_next SELECT * FROM payment_refunds;

CREATE TABLE payment_credit_ledger_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES payment_orders_next(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL REFERENCES payment_events_next(event_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('purchase','refund_adjustment')),
  credits INTEGER NOT NULL CHECK(credits<>0 AND (kind<>'purchase' OR credits>0)),
  created_at INTEGER NOT NULL,
  UNIQUE(order_id,source_event_id,kind)
);
INSERT INTO payment_credit_ledger_next SELECT * FROM payment_credit_ledger;
-- Keep the autoincrement high-water mark even if newer ledger rows were deleted.
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='payment_credit_ledger'),0))
  WHERE name='payment_credit_ledger_next';
INSERT INTO sqlite_sequence(name,seq)
  SELECT 'payment_credit_ledger_next',seq FROM sqlite_sequence WHERE name='payment_credit_ledger'
  AND NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='payment_credit_ledger_next');

DROP TABLE payment_credit_ledger;
DROP TABLE payment_refunds;
DROP TABLE payment_events;
DROP TABLE payment_orders;
ALTER TABLE payment_orders_next RENAME TO payment_orders;
ALTER TABLE payment_events_next RENAME TO payment_events;
ALTER TABLE payment_refunds_next RENAME TO payment_refunds;
ALTER TABLE payment_credit_ledger_next RENAME TO payment_credit_ledger;

CREATE INDEX payment_orders_owner ON payment_orders(user_id,mode,created_at DESC,id);
CREATE INDEX payment_refunds_order ON payment_refunds(order_id,succeeded_seen,failed_seen);
CREATE UNIQUE INDEX payment_purchase_once ON payment_credit_ledger(order_id) WHERE kind='purchase';
CREATE INDEX payment_credit_balance ON payment_credit_ledger(user_id,kind);
