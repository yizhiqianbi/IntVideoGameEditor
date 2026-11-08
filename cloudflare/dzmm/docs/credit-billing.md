# Credit consumption

The backend keeps consumption separate from recharge, refund, subscription and
community records. Apply `0015_credit_usage.sql` before deploying the new wallet
queries. No existing payment rows or ledger sequences are changed.

Billing remains disabled unless `CREDIT_BILLING_ENABLED` is exactly `true` and
`CREDIT_BILLING_RATES_JSON` contains only `revision`, `inputCreditsPer1000` and
`outputCreditsPer1000`, each an integer from 1 through 1,000,000. There are no
default commercial rates. An explicitly enabled service with invalid rates
returns 503; it cannot silently run model requests for free.

Each request freezes its rate revision, input/output rates, accepted provider
request fingerprint and token ceilings. The backend reserves
`ceil((inputTokenUpperBound * inputRate + maxOutputTokens * outputRate) / 1000)`
in one transactional D1 statement, checking acquired real Credit minus actual
consumption and active holds. Test Stripe balances and community points cannot
fund requests. Actual cost uses the same combined rounding with trusted
`promptTokens` and `completionTokens`; completion includes reasoning already,
without adding reasoning a second time or applying a cache discount.

The named Worker entrypoint `BillingService` is available only to trusted service
bindings. Public HTTP supports only GET `/v1/billing/config` and authenticated
GET `/v1/billing/usage`; no browser endpoint reserves, charges or refunds funds.

- `reserve({sessionToken,accountId,requestId,operation,model,inputTokenUpperBound,maxOutputTokens,requestFingerprint})`
  returns `{enabled:false}` only when disabled, otherwise
  `{enabled:true,receipt,created,claimToken?}`. The session is checked again in
  SQL. Only `created:true` may start provider execution. Replays cannot claim a
  second execution. A changed request under the same UUID is a 409 conflict.
- `finalize({reservationId,accountId,claimToken,outcome,hasValidOutput,usage?,generationId?})`
  returns `{receipt}`. No amount is accepted. Valid complete or partial output
  with verified usage settles actual cost and returns unused reserved Credit.
  Cost beyond the reservation is capped and flagged for review. No valid chat
  text or valid memory result releases everything; the merchant absorbs provider
  cost. Valid output without usage remains `pending` until reconciliation.
- `getPending(limit)` returns `{items}` with private generation IDs, frozen
  provider models and reconciliation capabilities. The gateway must verify
  generation metadata before calling `finalize` with trusted usage. These
  capabilities and metadata never appear in public records. Each bounded batch
  updates only its check timestamp and rotates the queue so ambiguous earlier
  generations cannot starve later requests; frozen facts remain unchanged.
- `releaseExpired(limit)` returns `{released}`; each batch is limited to 50.
  Pending requests lacking verified usage expire after ten minutes with
  `usage_timeout`. Abandoned reservations use `request_timeout`. Late settlement
  cannot reverse a release. Turning billing off does not prevent old settlement.

RPC failures use `{error:{status,message,code?}}`, preserving status safely across
Worker RPC. Unknown errors reveal only a generic 503 message. Private helpers
use JavaScript `#private` syntax and cannot be called through RPC.

The balance view excludes expired holds immediately, even if the cleanup cron is
unavailable. Mutation conditions use D1's current clock as well as the captured
request clock, preventing a delayed finalization from charging an expired hold
whose balance has funded a newer request. Verified external refunds can create
debt after Credit has been consumed: real refund facts remain intact, available
balance clamps to zero, debt is reported separately, and new reservations stop.

Public consumption pages are restricted to the current formal account, ordered
by descending `(createdAt,id)` with opaque cursors and a maximum of 50 items.
Each receipt has account identity, token usage, frozen rates, held/charged/returned
Credit, status and timestamps; it contains no text, request fingerprint, claim
token or provider generation ID.

`test/credit-usage.test.mjs` uses disposable actual D1/workerd storage for atomic
concurrency, replay, competing terminal facts, rollback, pending reconciliation,
expiry, refund debt, account isolation and actual named Worker RPC. Provider and
merchant networks are never contacted by these tests.
