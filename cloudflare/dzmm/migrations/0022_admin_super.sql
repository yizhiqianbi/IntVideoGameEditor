-- Administrative actions remain separate from verified payment facts.
CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  target_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('credit_adjustment','role_change')),
  delta INTEGER,
  previous_role TEXT,
  role TEXT,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 200),
  processing_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(actor_id,request_id),
  CHECK((action='credit_adjustment' AND delta BETWEEN -1000000 AND 1000000 AND delta<>0 AND previous_role IS NULL AND role IS NULL)
    OR (action='role_change' AND delta IS NULL AND previous_role IN ('user','super') AND role IN ('user','super')))
);
CREATE INDEX admin_audit_time ON admin_audit(created_at DESC,id DESC);
CREATE TABLE admin_credit_adjustments (
  audit_id TEXT PRIMARY KEY REFERENCES admin_audit(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  credits INTEGER NOT NULL CHECK(credits BETWEEN -1000000 AND 1000000 AND credits<>0),
  created_at INTEGER NOT NULL
);
CREATE INDEX admin_credit_owner ON admin_credit_adjustments(user_id);
DROP VIEW credit_usage_balances;
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
    )),0) AS granted_credits,
    -COALESCE((SELECT SUM(credits) FROM credit_usage_ledger WHERE user_id=u.id),0) AS total_spent,
    COALESCE((SELECT SUM(reserved_credits) FROM credit_usage_requests WHERE user_id=u.id AND status IN ('reserved','pending')
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0) AS reserved_credits
  FROM users u
);
-- Cost/usage and single-execution claims for Super. No monetary reservations or
-- consumption ledger rows are created. User role is checked at claim creation.
CREATE TABLE super_generation_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('chat','memory')),
  model TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  input_token_upper_bound INTEGER NOT NULL,
  max_output_tokens INTEGER NOT NULL,
  price_revision INTEGER NOT NULL,
  input_rate REAL NOT NULL,
  output_rate REAL NOT NULL,
  cost_policy_json TEXT,
  authorization_hash TEXT NOT NULL,
  reconciliation_token TEXT,
  generation_id TEXT,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','pending','settled','released')),
  has_valid_output INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  provider_cost_usd REAL,
  outcome TEXT,
  release_reason TEXT,
  last_reconciled_at INTEGER NOT NULL DEFAULT 0,
  processing_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  finalized_at INTEGER,
  UNIQUE(user_id,request_id)
);
CREATE INDEX super_usage_time ON super_generation_usage(created_at DESC,id DESC);
CREATE INDEX super_usage_pending ON super_generation_usage(last_reconciled_at,created_at) WHERE status='pending';
