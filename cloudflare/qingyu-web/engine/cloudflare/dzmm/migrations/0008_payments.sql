PRAGMA foreign_keys = ON;

-- Test-only purchased credits are isolated from community rewards and client state.
CREATE TABLE payment_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  package_id TEXT NOT NULL CHECK(package_id IN ('usd_1','usd_5','usd_10')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor IN (100,500,1000)),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK(currency='usd'),
  credits INTEGER NOT NULL CHECK(credits=amount_minor),
  mode TEXT NOT NULL DEFAULT 'test' CHECK(mode='test'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','partially_refunded','refunded','expired','failed')),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  checkout_url TEXT,
  refunded_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(refunded_amount_minor>=0 AND refunded_amount_minor<=amount_minor),
  refunded_credits INTEGER NOT NULL DEFAULT 0 CHECK(refunded_credits>=0 AND refunded_credits<=credits),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  UNIQUE(user_id,request_id),
  CHECK((package_id='usd_1' AND amount_minor=100) OR (package_id='usd_5' AND amount_minor=500) OR (package_id='usd_10' AND amount_minor=1000))
);
CREATE INDEX payment_orders_owner ON payment_orders(user_id,created_at DESC,id);

-- A batch's random token gates every write so concurrent deliveries have one winner.
CREATE TABLE payment_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  processing_token TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);

-- Stripe can report succeeded before an asynchronous refund fails. Failure is sticky.
CREATE TABLE payment_refunds (
  refund_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  currency TEXT NOT NULL CHECK(currency='usd'),
  succeeded_seen INTEGER NOT NULL DEFAULT 0 CHECK(succeeded_seen IN (0,1)),
  failed_seen INTEGER NOT NULL DEFAULT 0 CHECK(failed_seen IN (0,1)),
  updated_at INTEGER NOT NULL
);
CREATE INDEX payment_refunds_order ON payment_refunds(order_id,succeeded_seen,failed_seen);

CREATE TABLE payment_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL REFERENCES payment_events(event_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('purchase','refund_adjustment')),
  credits INTEGER NOT NULL CHECK(credits<>0 AND (kind<>'purchase' OR credits>0)),
  created_at INTEGER NOT NULL,
  UNIQUE(order_id,source_event_id,kind)
);
CREATE UNIQUE INDEX payment_purchase_once ON payment_credit_ledger(order_id) WHERE kind='purchase';
CREATE INDEX payment_credit_balance ON payment_credit_ledger(user_id,kind);
