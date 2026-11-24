-- Z-Pay live CNY purchases have their own graph. Stripe history, including its
-- sandbox ledger and historical callbacks, remains unchanged.
CREATE TABLE zpay_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  package_id TEXT NOT NULL CHECK(package_id IN ('cny_1','cny_5','cny_10')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor IN (100,500,1000)),
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
  CHECK((package_id='cny_1' AND amount_minor=100) OR (package_id='cny_5' AND amount_minor=500) OR (package_id='cny_10' AND amount_minor=1000))
);
CREATE INDEX zpay_orders_owner ON zpay_orders(user_id,created_at DESC,id);

CREATE TABLE zpay_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('notify','query','manual_refund')),
  order_id TEXT NOT NULL REFERENCES zpay_orders(id) ON DELETE CASCADE,
  provider_trade_no TEXT NOT NULL,
  processing_token TEXT NOT NULL,
  verified_at INTEGER NOT NULL
);

CREATE TABLE zpay_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES zpay_orders(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL REFERENCES zpay_events(event_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('purchase','refund_adjustment')),
  credits INTEGER NOT NULL CHECK(credits<>0 AND (kind<>'purchase' OR credits>0)),
  created_at INTEGER NOT NULL,
  UNIQUE(order_id,source_event_id,kind)
);
CREATE UNIQUE INDEX zpay_purchase_once ON zpay_credit_ledger(order_id) WHERE kind='purchase';
CREATE INDEX zpay_credit_balance ON zpay_credit_ledger(user_id,kind);

-- Provider order status=0 means unpaid and is never a refund fact. No public
-- refund route writes this table; confirmed refunds need a separate verified
-- administrative process and evidence before any credit adjustment is made.
CREATE TABLE zpay_refund_state (
  refund_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES zpay_orders(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  status TEXT NOT NULL CHECK(status IN ('requested','manual_review','confirmed','failed')),
  verification_reference TEXT,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(status<>'confirmed' OR (verified_at IS NOT NULL AND verification_reference IS NOT NULL AND length(verification_reference)>0))
);
