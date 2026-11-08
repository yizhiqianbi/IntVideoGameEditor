-- Keep password-reset challenges separate from the normal email sign-in flow.
-- Existing rows are normal sign-in challenges by default.
ALTER TABLE email_auth_challenges ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login'
  CHECK (purpose IN ('login', 'password_reset'));
CREATE INDEX email_auth_challenges_purpose ON email_auth_challenges(purpose, email, created_at DESC);
