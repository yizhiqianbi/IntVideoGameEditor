-- Additive model consumption graph. Applying this does not enable billing or
-- rewrite recharge/refund/subscription/community records.
CREATE TABLE credit_usage_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL CHECK(length(request_id)=36),
  operation TEXT NOT NULL CHECK(operation IN ('chat','memory')),
  model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 100),
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),
  price_revision INTEGER NOT NULL CHECK(price_revision BETWEEN 1 AND 1000000),
  input_rate INTEGER NOT NULL CHECK(input_rate BETWEEN 1 AND 1000000),
  output_rate INTEGER NOT NULL CHECK(output_rate BETWEEN 1 AND 1000000),
  input_token_upper_bound INTEGER NOT NULL CHECK(input_token_upper_bound BETWEEN 0 AND 1000000),
  max_output_tokens INTEGER NOT NULL CHECK(max_output_tokens BETWEEN 1 AND 1000000),
  reserved_credits INTEGER NOT NULL CHECK(reserved_credits BETWEEN 1 AND 1000000000),
  authorization_hash TEXT NOT NULL CHECK(length(authorization_hash)=64 AND authorization_hash NOT GLOB '*[^0-9a-f]*'),
  reconciliation_token TEXT,
  last_reconciled_at INTEGER NOT NULL DEFAULT 0 CHECK(last_reconciled_at>=0),
  generation_id TEXT CHECK(generation_id IS NULL OR length(generation_id) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','pending','settled','released')),
  charged_credits INTEGER NOT NULL DEFAULT 0 CHECK(charged_credits>=0 AND charged_credits<=reserved_credits),
  has_valid_output INTEGER NOT NULL DEFAULT 0 CHECK(has_valid_output IN (0,1)),
  prompt_tokens INTEGER CHECK(prompt_tokens BETWEEN 0 AND 1000000000),
  completion_tokens INTEGER CHECK(completion_tokens BETWEEN 0 AND 1000000000),
  usage_exceeds_reservation INTEGER NOT NULL DEFAULT 0 CHECK(usage_exceeds_reservation IN (0,1)),
  outcome TEXT CHECK(outcome IN ('completed','failed','cancelled','expired')),
  release_reason TEXT CHECK(release_reason IN ('no_valid_output','usage_timeout','request_timeout')),
  processing_token TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at=created_at+600000),
  pending_at INTEGER CHECK(pending_at>=created_at),
  finalized_at INTEGER CHECK(finalized_at>=created_at),
  UNIQUE(user_id,request_id),
  UNIQUE(id,user_id),
  CHECK((prompt_tokens IS NULL AND completion_tokens IS NULL) OR (prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL)),
  CHECK((status='reserved' AND charged_credits=0 AND has_valid_output=0 AND outcome IS NULL AND finalized_at IS NULL AND release_reason IS NULL AND prompt_tokens IS NULL)
    OR (status='pending' AND charged_credits=0 AND has_valid_output=1 AND outcome IN ('completed','failed','cancelled') AND finalized_at IS NULL AND release_reason IS NULL AND prompt_tokens IS NULL AND pending_at IS NOT NULL AND reconciliation_token IS NOT NULL)
    OR (status='settled' AND has_valid_output=1 AND prompt_tokens IS NOT NULL AND outcome IN ('completed','failed','cancelled') AND finalized_at IS NOT NULL AND release_reason IS NULL)
    OR (status='released' AND charged_credits=0 AND outcome IS NOT NULL AND finalized_at IS NOT NULL AND release_reason IS NOT NULL))
);
CREATE INDEX credit_usage_owner ON credit_usage_requests(user_id,created_at DESC,id DESC);
CREATE INDEX credit_usage_active ON credit_usage_requests(expires_at,user_id) WHERE status IN ('reserved','pending');
CREATE INDEX credit_usage_pending_check ON credit_usage_requests(last_reconciled_at,created_at,id) WHERE status='pending';

-- Exactly one terminal fact. Releasing a hold is a zero debit, never a new grant.
CREATE TABLE credit_usage_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usage_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('charge','release')),
  credits INTEGER NOT NULL CHECK((kind='charge' AND credits<=0) OR (kind='release' AND credits=0)),
  outcome TEXT NOT NULL CHECK(outcome IN ('completed','failed','cancelled','expired')),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  FOREIGN KEY(usage_id,user_id) REFERENCES credit_usage_requests(id,user_id) ON DELETE CASCADE
);
CREATE INDEX credit_usage_balance ON credit_usage_ledger(user_id);

-- Real acquired Credit only: no sandbox Stripe, unclaimed rights or task points.
-- Verified external refunds may create debt; they must never be hidden or edited.
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
    )),0) AS granted_credits,
    -COALESCE((SELECT SUM(credits) FROM credit_usage_ledger WHERE user_id=u.id),0) AS total_spent,
    COALESCE((SELECT SUM(reserved_credits) FROM credit_usage_requests WHERE user_id=u.id AND status IN ('reserved','pending')
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0) AS reserved_credits
  FROM users u
);
