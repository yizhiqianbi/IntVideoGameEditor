-- A trusted one-time administrative grant is not a payment or VIP check-in.
-- Only deployment/operator SQL may insert grants; no public API writes here.
-- Reuse the exact grant_key on retries and verify its complete stored payload.
CREATE TABLE trusted_credit_grants (
  grant_key TEXT PRIMARY KEY CHECK(length(grant_key) BETWEEN 1 AND 128),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credits INTEGER NOT NULL CHECK(typeof(credits)='integer' AND credits BETWEEN 1 AND 1000000000000),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0)
);
CREATE INDEX trusted_credit_grant_owner ON trusted_credit_grants(user_id);
-- Preserve all existing ledgers and reservations. New Super requests now use
-- this ordinary numeric wallet and the existing authoritative settlement rules.
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
      UNION ALL SELECT credits FROM trusted_credit_grants WHERE user_id=u.id
    )),0) AS granted_credits,
    -COALESCE((SELECT SUM(credits) FROM credit_usage_ledger WHERE user_id=u.id),0) AS total_spent,
    COALESCE((SELECT SUM(reserved_credits) FROM credit_usage_requests WHERE user_id=u.id AND status IN ('reserved','pending')
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0) AS reserved_credits
  FROM users u
);
