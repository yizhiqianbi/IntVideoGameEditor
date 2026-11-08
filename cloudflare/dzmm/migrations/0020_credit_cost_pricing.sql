-- Freeze actual-cost conversion policy per request. Historical reservations
-- keep NULL and retain their original token tariff and immutable ledger.
ALTER TABLE credit_usage_requests ADD COLUMN cost_policy_json TEXT
  CHECK(cost_policy_json IS NULL OR (json_valid(cost_policy_json) AND json_type(cost_policy_json)='object'));
ALTER TABLE credit_usage_requests ADD COLUMN provider_cost_usd REAL
  CHECK(provider_cost_usd IS NULL OR (provider_cost_usd>=0 AND provider_cost_usd<=1000000));
