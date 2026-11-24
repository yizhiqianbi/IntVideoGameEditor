/**
 * Single-statement D1 snapshot. Only numeric aggregates and allowlisted business
 * dimensions leave the database; no account IDs, emails, titles or content do.
 * All business timestamps are Unix milliseconds. Report events use [start,end),
 * while entitlement, wallet and queue gauges use the supplied snapshot clock.
 * Current account roles determine the ordinary/super split; this is not a
 * historical identity audit. Deleted rows cannot be reconstructed.
 */
const DAY = 86400000;
const array = sql => `json((SELECT COALESCE(json_group_array(json(row_json)), '[]') FROM (${sql})))`;
const count = (table, where = '1') => `(SELECT COUNT(*) FROM ${table} WHERE ${where})`;
const sum = (table, column, where = '1') => `(SELECT COALESCE(SUM(${column}),0) FROM ${table} WHERE ${where})`;
const object = fields => `json_object(${Object.entries(fields).flatMap(([key, value]) => [`'${key}'`, value]).join(',\n')})`;

export function buildSnapshotSql({ startMs, endMs, snapshotMs }) {
  for (const value of [startMs, endMs, snapshotMs]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000 - 7 * DAY) {
      throw new Error('Snapshot clocks must be nonnegative safe Unix milliseconds.');
    }
  }
  if (endMs <= startMs || snapshotMs < endMs) throw new Error('Report interval must be completed before its snapshot.');
  const day = column => `${column}>=${startMs} AND ${column}<${endMs}`;
  const ordinary = 'user_id IN (SELECT id FROM ordinary_users)';
  const superUser = 'user_id IN (SELECT id FROM super_users)';
  const ordinaryAlias = alias => `${alias}.user_id IN (SELECT id FROM ordinary_users)`;
  const paymentGroups = cohort => array(`
    SELECT json_patch(json_object('provider',provider,'kind',kind,'currency',currency,'orderCount',COUNT(*),
      'grossAmountMinor',SUM(amount_minor),'refundAmountMinorCurrentlyForTheseOrders',SUM(refunded_amount_minor)),
      CASE WHEN currency='usdt' THEN json_object('amountScale',amount_scale) ELSE '{}' END) AS row_json
    FROM all_orders WHERE scope='${cohort}' AND mode='live' AND ${day('paid_at')}
      AND status IN ('paid','partially_refunded','refunded')
    GROUP BY provider,kind,currency,amount_scale ORDER BY provider,kind,currency,amount_scale`);
  const usageGroups = (table, filter) => array(`
    SELECT json_object('operation',operation,'model',model,'status',status,'requestsCreated',COUNT(*),
      'promptTokensKnown',COALESCE(SUM(prompt_tokens),0),'completionTokensKnown',COALESCE(SUM(completion_tokens),0),
      'tokenUsageUnknownCount',SUM(CASE WHEN prompt_tokens IS NULL OR completion_tokens IS NULL THEN 1 ELSE 0 END),
      'providerCostUsdKnown',COALESCE(SUM(provider_cost_usd),0),
      'providerCostUnknownCount',SUM(CASE WHEN provider_cost_usd IS NULL THEN 1 ELSE 0 END)) AS row_json
    FROM ${table} WHERE ${filter} AND ${day('created_at')} GROUP BY operation,model,status ORDER BY operation,model,status`);
  const generationGroups = filter => array(`
    SELECT json_object('kind',kind,'model',model_id,'status',status,'jobsCreated',COUNT(*),
      'providerCostUsdKnown',COALESCE(SUM(provider_cost_usd),0),
      'providerCostUnknownCount',SUM(CASE WHEN provider_cost_usd IS NULL THEN 1 ELSE 0 END),
      'costBasis',cost_basis) AS row_json FROM generation_jobs WHERE ${filter} AND ${day('created_at')}
    GROUP BY kind,model_id,status,cost_basis ORDER BY kind,model_id,status,cost_basis`);
  const walletMetric = (cohort, metric) => sum('wallets', metric, `scope='${cohort}'`);
  const users = object({
    ordinaryRegisteredTotal: count('ordinary_users'),
    guestTotal: count('users', "is_demo=0 AND is_guest=1 AND role='user'"),
    demoTotal: count('users', 'is_demo=1'),
    superTotal: count('super_users'),
    // Registration gift is written atomically for fresh accounts and converted
    // guests. users.created_at remains the older guest creation time.
    newRegistrationsByGrant: count('trusted_credit_grants', `${ordinary} AND reason='new_signup' AND grant_key='new_signup:'||user_id AND ${day('created_at')}`),
    // This secondary creation-clock gauge overlaps the registration receipt
    // gauge; never add them. It also misses older guests converted today.
    legacyAccountsCreatedInDay: count('ordinary_users', day('created_at')),
    activeUsersByRecordedActions: '(SELECT COUNT(DISTINCT user_id) FROM activity WHERE user_id IN (SELECT id FROM ordinary_users))',
  });
  const subscriptions = object({
    activeVipUsersCurrent: '(SELECT COUNT(DISTINCT user_id) FROM active_periods)',
    activePeriodsCurrent: count('active_periods'),
    queuedPeriodsCurrent: count('ordinary_periods', `revoked_at IS NULL AND order_status='paid' AND starts_at>${snapshotMs}`),
    expiringUsersNext7Days: `(SELECT COUNT(*) FROM (SELECT user_id,MAX(expires_at) AS final_expiry FROM ordinary_periods
      WHERE revoked_at IS NULL AND order_status='paid' AND user_id IN (SELECT user_id FROM active_periods)
      GROUP BY user_id) WHERE final_expiry>${snapshotMs} AND final_expiry<=${snapshotMs + 7 * DAY})`,
    newPaidOrdersInDay: count('ordinary_subscription_orders', `${day('paid_at')} AND status IN ('paid','refunded')`),
    firstPurchaseOrdersInDay: count('ordinary_subscription_orders o', `${day('o.paid_at')} AND o.status IN ('paid','refunded')
      AND NOT EXISTS(SELECT 1 FROM ordinary_subscription_orders prior WHERE prior.user_id=o.user_id AND prior.status IN ('paid','refunded')
      AND prior.paid_at IS NOT NULL AND (prior.paid_at<o.paid_at OR (prior.paid_at=o.paid_at AND prior.id<o.id)))`),
    repeatPurchaseOrdersInDay: count('ordinary_subscription_orders o', `${day('o.paid_at')} AND o.status IN ('paid','refunded')
      AND EXISTS(SELECT 1 FROM ordinary_subscription_orders prior WHERE prior.user_id=o.user_id AND prior.status IN ('paid','refunded')
      AND prior.paid_at IS NOT NULL AND (prior.paid_at<o.paid_at OR (prior.paid_at=o.paid_at AND prior.id<o.id)))`),
    dailyClaimCount: count('subscription_daily_claims', `${ordinary} AND ${day('claimed_at')}`),
    dailyClaimCredits: sum('subscription_daily_claims', 'credits', `${ordinary} AND ${day('claimed_at')}`),
    revokedPeriodsInDay: count('ordinary_periods', day('revoked_at')),
    refundedOrdersTotal: count('ordinary_subscription_orders', "status='refunded'"),
    refundCashflowInDay: 'NULL',
    automaticRenewal: 'json(\'false\')',
  });
  const payments = object({
    paid: paymentGroups('ordinary'),
    superPaid: paymentGroups('super'),
    createdByStatus: array(`SELECT json_object('provider',provider,'kind',kind,'mode',mode,'status',status,'orderCount',COUNT(*)) AS row_json
      FROM all_orders WHERE scope='ordinary' AND ${day('created_at')} GROUP BY provider,kind,mode,status ORDER BY provider,kind,mode,status`),
    // Neither refund graph proves when the payment provider sent the cash. Zpay
    // has a verified receipt clock; Stripe only stores the latest state update.
    refunds: array(`SELECT json_object('provider','stripe','currency',r.currency,'confirmedCount',COUNT(*),
      'amountMinor',SUM(r.amount_minor),'basis','last_refund_state_update_not_cash_time') AS row_json
      FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id
      WHERE ${ordinaryAlias('o')} AND o.mode='live' AND r.succeeded_seen=1 AND r.failed_seen=0 AND ${day('r.updated_at')} GROUP BY r.currency
      UNION ALL SELECT json_object('provider','zpay','currency',o.currency,'confirmedCount',COUNT(*),
      'amountMinor',SUM(r.amount_minor),'basis','verified_receipt_time_not_cash_time')
      FROM zpay_refund_state r JOIN zpay_orders o ON o.id=r.order_id
      WHERE ${ordinaryAlias('o')} AND r.status='confirmed' AND ${day('r.verified_at')} GROUP BY o.currency`),
    subscriptionRefundedOrdersTotal: count('ordinary_subscription_orders', "status='refunded'"),
  });
  const credits = object({
    grants: array(`SELECT json_object('source',source,'count',COUNT(*),'credits',SUM(credits)) AS row_json FROM all_grants
      WHERE ${ordinary} AND ${day('created_at')} GROUP BY source ORDER BY source`),
    modelChargeCredits: `-${sum('credit_usage_ledger', 'credits', `${ordinary} AND kind='charge' AND ${day('created_at')}`)}`,
    mediaChargeCredits: `-${sum('generation_credit_ledger', 'credits', `${ordinary} AND kind='charge' AND ${day('created_at')}`)}`,
    modelReleaseCount: count('credit_usage_ledger', `${ordinary} AND kind='release' AND ${day('created_at')}`),
    mediaReleaseCount: count('generation_credit_ledger', `${ordinary} AND kind='release' AND ${day('created_at')}`),
    currentAvailableCredits: walletMetric('ordinary','balance'),
    currentReservedCredits: walletMetric('ordinary','reserved'),
    currentDebtCredits: walletMetric('ordinary','debt'),
    super: object({
      modelChargeCredits: `-${sum('credit_usage_ledger', 'credits', `${superUser} AND kind='charge' AND ${day('created_at')}`)}`,
      mediaChargeCredits: `-${sum('generation_credit_ledger', 'credits', `${superUser} AND kind='charge' AND ${day('created_at')}`)}`,
      currentAvailableCredits: walletMetric('super','balance'),
    }),
  });
  const modelUsage = object({
    ordinary: usageGroups('credit_usage_requests', ordinary),
    super: usageGroups('credit_usage_requests', superUser),
    legacySuper: usageGroups('super_generation_usage', '1'),
  });
  const generation = object({
    ordinary: generationGroups(ordinary),
    super: generationGroups(superUser),
    chatMedia: array(`SELECT json_object('kind',kind,'status',status,'requestsCreated',COUNT(*),'providerCostUsd',NULL) AS row_json
      FROM chat_media_usage WHERE ${ordinary} AND ${day('created_at')} GROUP BY kind,status ORDER BY kind,status`),
    live: 'NULL',
  });
  const community = object({
    postsCreated: count('forum_posts', `${ordinary} AND demo_batch_id IS NULL AND ${day('created_at')}`),
    repliesCreated: count('forum_replies', `${ordinary} AND demo_batch_id IS NULL AND ${day('created_at')}`),
    demoPostsCreated: count('forum_posts', `demo_batch_id IS NOT NULL AND ${day('created_at')}`),
    demoRepliesCreated: count('forum_replies', `demo_batch_id IS NOT NULL AND ${day('created_at')}`),
    pendingReportsCurrent: count('forum_reports', `${ordinary} AND status='pending'`),
    tasksCreated: count('task_market_tasks', `${ordinary} AND ${day('created_at')}`),
    assignmentsCreated: count('task_market_assignments', `${ordinary} AND ${day('created_at')}`),
    communityRewardPoints: sum('task_market_rewards', 'points', `${ordinary} AND ${day('claimed_at')}`),
  });
  const creation = object({
    newNovels: count('novels', `${ordinary} AND ${day('created_at')}`),
    newGames: count('creator_games', `${ordinary} AND ${day('created_at')}`),
    newScenarios: count('creator_scenarios', `${ordinary} AND ${day('created_at')}`),
    newPublications: count('character_publications', `${ordinary} AND ${day('created_at')}`),
    submissionsCreated: count('character_submissions s JOIN character_publications p ON p.id=s.publication_id', `${ordinaryAlias('p')} AND ${day('s.created_at')}`),
    pendingSubmissionsCurrent: count('character_submissions s JOIN character_publications p ON p.id=s.publication_id', `${ordinaryAlias('p')} AND s.status='pending'`),
    conversationsUpdated: count('conversations', `${ordinary} AND ${day('updated_at')}`),
    messagesTotalCurrent: count('messages', ordinary),
    privateCharactersTotalCurrent: count('characters', ordinary),
  });
  const feedback = object({
    received: count('telegram_feedback', day('created_at')),
    statusCurrent: array(`SELECT json_object('status',status,'count',COUNT(*)) AS row_json FROM telegram_feedback GROUP BY status ORDER BY status`),
    decisionsInDay: count('telegram_feedback_decisions', day('created_at')),
  });

  return `WITH
ordinary_users AS (SELECT id,created_at FROM users WHERE is_demo=0 AND is_guest=0 AND role='user'),
super_users AS (SELECT id FROM users WHERE is_demo=0 AND role='super'),
all_orders AS (
  SELECT o.id,o.user_id,'stripe' AS provider,'recharge' AS kind,o.currency,o.mode,o.status,o.amount_minor,2 AS amount_scale,o.refunded_amount_minor,o.created_at,o.paid_at,
    CASE WHEN u.is_demo=0 AND u.is_guest=0 AND u.role='user' THEN 'ordinary' WHEN u.is_demo=0 AND u.role='super' THEN 'super' ELSE 'excluded' END AS scope
  FROM payment_orders o JOIN users u ON u.id=o.user_id
  UNION ALL SELECT o.id,o.user_id,'zpay','recharge',o.currency,'live',o.status,o.amount_minor,2,o.refunded_amount_minor,o.created_at,o.paid_at,
    CASE WHEN u.is_demo=0 AND u.is_guest=0 AND u.role='user' THEN 'ordinary' WHEN u.is_demo=0 AND u.role='super' THEN 'super' ELSE 'excluded' END
  FROM zpay_orders o JOIN users u ON u.id=o.user_id
  UNION ALL SELECT o.id,o.user_id,CASE WHEN o.provider='nowpayments' THEN 'nowpayments' ELSE 'zpay' END,'subscription',o.currency,'live',o.status,o.amount_minor,o.amount_scale,NULL,o.created_at,o.paid_at,
    CASE WHEN u.is_demo=0 AND u.is_guest=0 AND u.role='user' THEN 'ordinary' WHEN u.is_demo=0 AND u.role='super' THEN 'super' ELSE 'excluded' END
  FROM subscription_orders o JOIN users u ON u.id=o.user_id
),
ordinary_subscription_orders AS (SELECT * FROM subscription_orders WHERE ${ordinary}),
ordinary_periods AS (SELECT p.*,o.status AS order_status FROM subscription_periods p
  JOIN ordinary_subscription_orders o ON o.id=p.order_id AND o.user_id=p.user_id),
active_periods AS (SELECT * FROM ordinary_periods WHERE revoked_at IS NULL AND order_status='paid'
  AND starts_at<=${snapshotMs} AND expires_at>${snapshotMs}),
all_grants AS (
  SELECT l.user_id,l.credits,l.created_at,'stripe_'||l.kind AS source FROM payment_credit_ledger l JOIN payment_orders o ON o.id=l.order_id WHERE o.mode='live'
  UNION ALL SELECT user_id,credits,created_at,'zpay_'||kind FROM zpay_credit_ledger
  UNION ALL SELECT user_id,credits,created_at,'vip_daily_grant' FROM subscription_credit_ledger
  UNION ALL SELECT user_id,credits,created_at,'admin_adjustment' FROM admin_credit_adjustments
  UNION ALL SELECT user_id,credits,created_at,CASE WHEN reason='new_signup' AND grant_key='new_signup:'||user_id THEN 'signup_gift' ELSE 'operator_grant' END FROM trusted_credit_grants
),
all_debits AS (
  SELECT user_id,credits FROM credit_usage_ledger UNION ALL SELECT user_id,credits FROM generation_credit_ledger
),
all_holds AS (
  SELECT user_id,reserved_credits FROM credit_usage_requests WHERE status IN ('reserved','pending') AND expires_at>${snapshotMs}
  UNION ALL SELECT user_id,reserved_credits FROM generation_jobs WHERE finalized_at IS NULL AND expires_at>${snapshotMs}
),
wallet_input AS (SELECT u.id,u.scope,
  COALESCE((SELECT SUM(credits) FROM all_grants WHERE user_id=u.id),0) AS granted,
  -COALESCE((SELECT SUM(credits) FROM all_debits WHERE user_id=u.id),0) AS spent,
  COALESCE((SELECT SUM(reserved_credits) FROM all_holds WHERE user_id=u.id),0) AS reserved
  FROM (SELECT id,'ordinary' AS scope FROM ordinary_users UNION ALL SELECT id,'super' FROM super_users) u),
wallets AS (SELECT scope,MAX(0,granted-spent-reserved) AS balance,reserved,MAX(0,spent-granted) AS debt FROM wallet_input),
activity AS (
  -- D1 rejects the former thirteen-term compound SELECT although desktop
  -- SQLite accepts it. One row per eligible user plus EXISTS preserves the
  -- union's distinct-account semantics without a long compound statement.
  SELECT u.id AS user_id FROM ordinary_users u WHERE
    EXISTS(SELECT 1 FROM sessions a WHERE a.user_id=u.id AND ${day('a.created_at')})
    OR EXISTS(SELECT 1 FROM trusted_credit_grants a WHERE a.user_id=u.id AND a.reason='new_signup' AND ${day('a.created_at')})
    OR EXISTS(SELECT 1 FROM credit_usage_requests a WHERE a.user_id=u.id AND ${day('a.created_at')})
    OR EXISTS(SELECT 1 FROM generation_jobs a WHERE a.user_id=u.id AND ${day('a.created_at')})
    OR EXISTS(SELECT 1 FROM chat_media_usage a WHERE a.user_id=u.id AND ${day('a.created_at')})
    OR EXISTS(SELECT 1 FROM subscription_daily_claims a WHERE a.user_id=u.id AND ${day('a.claimed_at')})
    OR EXISTS(SELECT 1 FROM all_orders a WHERE a.user_id=u.id AND ${day('a.created_at')})
    OR EXISTS(SELECT 1 FROM forum_posts a WHERE a.user_id=u.id AND ${day('a.created_at')})
    OR EXISTS(SELECT 1 FROM forum_replies a WHERE a.user_id=u.id AND ${day('a.created_at')})
    OR EXISTS(SELECT 1 FROM conversations a WHERE a.user_id=u.id AND ${day('a.updated_at')})
    OR EXISTS(SELECT 1 FROM novels a WHERE a.user_id=u.id AND ${day('a.updated_at')})
    OR EXISTS(SELECT 1 FROM creator_games a WHERE a.user_id=u.id AND ${day('a.updated_at')})
    OR EXISTS(SELECT 1 FROM creator_scenarios a WHERE a.user_id=u.id AND ${day('a.updated_at')})
)
SELECT ${users} AS users,
${subscriptions} AS subscriptions,
${payments} AS payments,
${credits} AS credits,
${modelUsage} AS modelUsage,
${generation} AS generation,
${community} AS community,
${creation} AS creation,
${feedback} AS feedback;`;
}
