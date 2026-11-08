-- Independent consumer image/video jobs. Prices and provider requests are frozen
-- before submission; soft deletion preserves idempotency and financial receipts.
CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY CHECK(length(id)=36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL CHECK(length(request_id)=36),
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64),
  kind TEXT NOT NULL CHECK(kind IN ('image','video')),
  model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 100),
  prompt TEXT NOT NULL CHECK(length(prompt) BETWEEN 1 AND 4000 AND instr(prompt,char(0))=0),
  template_id TEXT CHECK(template_id IS NULL OR length(template_id) BETWEEN 1 AND 100),
  aspect_ratio TEXT NOT NULL,
  duration INTEGER CHECK(duration IS NULL OR duration BETWEEN 1 AND 30),
  status TEXT NOT NULL CHECK(status IN ('pending','processing','ready','failed','unknown')),
  provider_job_id TEXT CHECK(provider_job_id IS NULL OR length(provider_job_id) BETWEEN 1 AND 200),
  policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
  reserved_credits INTEGER NOT NULL CHECK(typeof(reserved_credits)='integer' AND reserved_credits BETWEEN 1 AND 1000000000),
  charged_credits INTEGER NOT NULL DEFAULT 0 CHECK(typeof(charged_credits)='integer' AND charged_credits BETWEEN 0 AND reserved_credits),
  provider_cost_usd REAL CHECK(provider_cost_usd IS NULL OR provider_cost_usd>=0),
  cost_basis TEXT CHECK(cost_basis IS NULL OR cost_basis IN ('provider_usage','frozen_sku','released')),
  exceeds_reservation INTEGER NOT NULL DEFAULT 0 CHECK(exceeds_reservation IN (0,1)),
  processing_token TEXT NOT NULL,
  poll_token TEXT,
  poll_started_at INTEGER NOT NULL DEFAULT 0,
  object_key TEXT,
  mime_type TEXT,
  byte_length INTEGER CHECK(byte_length IS NULL OR byte_length>0),
  error_code TEXT,
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
  expires_at INTEGER NOT NULL CHECK(expires_at=created_at+1800000),
  finalized_at INTEGER CHECK(finalized_at IS NULL OR finalized_at>=created_at),
  deleted_at INTEGER,
  UNIQUE(user_id,request_id),
  UNIQUE(id,user_id),
  CHECK((kind='image' AND duration IS NULL) OR (kind='video' AND duration IS NOT NULL)),
  CHECK(status!='ready' OR (object_key IS NOT NULL AND mime_type IS NOT NULL AND byte_length IS NOT NULL AND finalized_at IS NOT NULL)),
  CHECK(finalized_at IS NULL OR status IN ('ready','failed','unknown'))
);
CREATE INDEX generation_jobs_owner ON generation_jobs(user_id,created_at DESC,id);
CREATE INDEX generation_jobs_expiry ON generation_jobs(expires_at,user_id) WHERE finalized_at IS NULL;
CREATE TABLE generation_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('charge','release')),
  credits INTEGER NOT NULL CHECK(typeof(credits)='integer' AND ((kind='charge' AND credits<=0) OR (kind='release' AND credits=0))),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  FOREIGN KEY(job_id,user_id) REFERENCES generation_jobs(id,user_id) ON DELETE CASCADE
);
CREATE INDEX generation_credit_owner ON generation_credit_ledger(user_id);
-- Preserve all five real grants and the existing model consumption graph.
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
    -COALESCE((SELECT SUM(credits) FROM credit_usage_ledger WHERE user_id=u.id),0)
      -COALESCE((SELECT SUM(credits) FROM generation_credit_ledger WHERE user_id=u.id),0) AS total_spent,
    COALESCE((SELECT SUM(reserved_credits) FROM credit_usage_requests WHERE user_id=u.id AND status IN ('reserved','pending')
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(reserved_credits) FROM generation_jobs WHERE user_id=u.id AND finalized_at IS NULL
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0) AS reserved_credits
  FROM users u
);
