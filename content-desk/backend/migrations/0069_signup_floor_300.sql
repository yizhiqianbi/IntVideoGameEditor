-- Raise registered accounts whose available balance is below the new 300
-- Credit signup floor. Guests, demo accounts, and anyone already at or above
-- 300 are left unchanged. The grant key makes a retry insert nothing.
INSERT INTO trusted_credit_grants(grant_key, user_id, credits, reason, created_at)
SELECT 'signup_floor_300:' || u.id,
       u.id,
       300 - b.balance,
       'signup_floor_300',
       CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM users u
JOIN credit_usage_balances b ON b.user_id = u.id
WHERE u.is_guest = 0
  AND u.is_demo = 0
  AND b.balance < 300
ON CONFLICT(grant_key) DO NOTHING;
