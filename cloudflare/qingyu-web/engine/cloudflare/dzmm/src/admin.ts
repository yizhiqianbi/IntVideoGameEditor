import { digest, requireUser, tokenFrom } from "./auth";
import { publicCreditBillingConfig } from "./credit-usage";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const NOW = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const ACTOR = `EXISTS(SELECT 1 FROM users a JOIN sessions s ON s.user_id=a.id WHERE a.id=? AND a.is_guest=0 AND a.role='super' AND s.token_hash=? AND s.expires_at>${NOW})`;
const USER_COLUMNS = `SELECT u.id,u.email,u.nickname,u.is_guest,u.role,u.created_at,u.email_verified_at,
  b.balance,b.reserved_credits,b.total_spent,b.debt_credits,
  COALESCE((SELECT SUM(credits) FROM (SELECT credits FROM admin_credit_adjustments WHERE user_id=u.id UNION ALL SELECT credits FROM trusted_credit_grants WHERE user_id=u.id)),0) AS adjusted,
  (SELECT MAX(expires_at) FROM subscription_periods WHERE user_id=u.id AND revoked_at IS NULL AND starts_at<=${NOW} AND expires_at>${NOW}) AS vip_expires
  FROM users u JOIN credit_usage_balances b ON b.user_id=u.id`;
type UserRow = { id:string;email:string|null;nickname:string;is_guest:number;role:"user"|"super";created_at:number;email_verified_at:number|null;
  balance:number;reserved_credits:number;total_spent:number;debt_credits:number;adjusted:number;vip_expires:number|null };
type AuditRow = { id:string;actor_id:string;target_user_id:string;request_id:string;action:string;delta:number|null;previous_role:string|null;role:string|null;reason:string;created_at:number };
function publicUser(row: UserRow) { return {id:row.id,email:row.email,nickname:row.nickname,isGuest:row.is_guest===1,role:row.role,
  createdAt:row.created_at,emailVerified:row.email_verified_at!==null,creditUnlimited:false,billingExempt:false,
  availableCredits:row.balance,reservedCredits:row.reserved_credits,totalSpentCredits:row.total_spent,debtCredits:row.debt_credits,
  adminAdjustedCredits:row.adjusted,subscription:{active:row.vip_expires!==null,expiresAt:row.vip_expires}}; }
function publicAudit(row: AuditRow) { return {id:row.id,actorId:row.actor_id,targetUserId:row.target_user_id,requestId:row.request_id,
  action:row.action,delta:row.delta,previousRole:row.previous_role,role:row.role,reason:row.reason,createdAt:row.created_at}; }
function page(url:URL, extras:string[]=[]) {
  const allowed=['limit','offset',...extras];
  if ([...url.searchParams.keys()].some(key=>!allowed.includes(key)||url.searchParams.getAll(key).length!==1)) throw new ApiError(400,'管理查询参数无效。');
  const integer=(key:string,fallback:number,max:number,min=0)=>{const raw=url.searchParams.get(key);if(raw===null)return fallback;
    if(!/^\d{1,6}$/.test(raw)||Number(raw)<min||Number(raw)>max)throw new ApiError(400,'分页参数无效。');return Number(raw);};
  return {limit:integer('limit',20,50,1),offset:integer('offset',0,100000)};
}
function targetId(source:string) { if(!UUID.test(source))throw new ApiError(400,'账户编号无效。');return source.toLowerCase(); }
function userFilter(url:URL) { const id=url.searchParams.get('userId');return id===null?null:targetId(id); }
function envelope(user:UserRecord,items:unknown[],total:number,limit:number,offset:number) {return {accountId:user.id,creditUnlimited:false,billingExempt:false,items,total,limit,offset,hasMore:offset+limit<total};}
const ORDERS = `SELECT o.id,o.user_id,u.nickname,'stripe' AS provider,o.mode,'recharge' AS kind,o.currency,o.amount_minor,2 AS amount_scale,o.credits,o.status,o.created_at,o.paid_at
  FROM payment_orders o JOIN users u ON u.id=o.user_id UNION ALL
  SELECT o.id,o.user_id,u.nickname,'zpay','live','recharge',o.currency,o.amount_minor,2,o.credits,o.status,o.created_at,o.paid_at FROM zpay_orders o JOIN users u ON u.id=o.user_id UNION ALL
  SELECT o.id,o.user_id,u.nickname,'guagua','live','recharge',o.currency,o.amount_minor,2,o.credits,o.status,o.created_at,o.paid_at FROM guagua_orders o JOIN users u ON u.id=o.user_id UNION ALL
  SELECT o.id,o.user_id,u.nickname,CASE WHEN o.provider='nowpayments' THEN 'nowpayments' WHEN o.provider='waffo' THEN 'waffo' ELSE 'subscription' END,CASE WHEN o.provider='waffo' THEN 'sandbox' ELSE 'live' END,'subscription',o.currency,o.amount_minor,o.amount_scale,NULL,o.status,o.created_at,o.paid_at FROM subscription_orders o JOIN users u ON u.id=o.user_id`;
const USAGE = `SELECT r.id,r.user_id,u.nickname,r.operation,r.model,r.status,r.charged_credits,r.reserved_credits,r.provider_cost_usd,r.prompt_tokens,r.completion_tokens,0 AS billing_exempt,r.created_at,r.finalized_at
  FROM credit_usage_requests r JOIN users u ON u.id=r.user_id UNION ALL
  SELECT r.id,r.user_id,u.nickname,r.operation,r.model,r.status,0,0,r.provider_cost_usd,r.prompt_tokens,r.completion_tokens,1,r.created_at,r.finalized_at FROM super_generation_usage r JOIN users u ON u.id=r.user_id`;
async function overview(env:Env,user:UserRecord) {
  const results=await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS users,SUM(is_guest=0) AS registeredUsers,SUM(is_guest=1) AS guestUsers,SUM(role='super' AND is_guest=0) AS superUsers,
      COALESCE(SUM(b.balance),0) AS totalAvailableCredits,COALESCE(SUM(b.reserved_credits),0) AS totalReservedCredits,COALESCE(SUM(b.total_spent),0) AS totalSpentCredits
      FROM users u JOIN credit_usage_balances b ON b.user_id=u.id WHERE u.is_demo=0`),
    env.DB.prepare(`SELECT (SELECT COUNT(*) FROM (${USAGE}) WHERE status='pending') AS pendingUsage,
      (SELECT COUNT(DISTINCT user_id) FROM subscription_periods WHERE revoked_at IS NULL AND starts_at<=${NOW} AND expires_at>${NOW}) AS activeSubscriptions,
      (SELECT COUNT(*) FROM character_submissions WHERE status='pending') AS pendingSubmissions,(SELECT COUNT(*) FROM forum_posts) AS forumPosts`),
    env.DB.prepare(`SELECT provider,currency,mode,amount_scale,SUM(amount_minor) AS amountMinor,COUNT(*) AS paidOrders FROM (${ORDERS}) WHERE paid_at IS NOT NULL GROUP BY provider,currency,mode,amount_scale`),
  ]);
  const revenue=results[2].results.map(({amount_scale,...row}:any)=>({...row,...(row.currency==='usdt'?{amountScale:amount_scale}:{})}));
  return json({accountId:user.id,creditUnlimited:false,billingExempt:false,serverTime:Date.now(),stats:{...(results[0].results[0] as object),...(results[1].results[0] as object)},revenue,
    billing:publicCreditBillingConfig(env),capabilities:{userRoles:true,creditAdjustments:true,paymentOrders:true,usageMetadata:true,privateConversations:false}});
}
async function users(env:Env,user:UserRecord,url:URL) {
  const {limit,offset}=page(url,['q','role']);const role=url.searchParams.get('role'),q=url.searchParams.get('q')??'';
  if(q.length>120||/[\0\r\n]/.test(q)||(role!==null&&role!=='super'&&role!=='user'))throw new ApiError(400,'搜索条件无效。');
  const pattern=q.toLowerCase(),where="WHERE u.is_demo=0 AND (? IS NULL OR u.role=?) AND (instr(lower(COALESCE(u.email,'')),?)>0 OR instr(lower(u.nickname),?)>0 OR instr(lower(u.id),?)>0)";
  const results=await env.DB.batch([env.DB.prepare(`${USER_COLUMNS} ${where} ORDER BY u.created_at DESC,u.id DESC LIMIT ? OFFSET ?`).bind(role,role,pattern,pattern,pattern,limit,offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).bind(role,role,pattern,pattern,pattern)]);
  return json(envelope(user,(results[0].results as UserRow[]).map(publicUser),Number((results[1].results[0] as {n:number}).n),limit,offset));
}
async function listing(env:Env,user:UserRecord,url:URL,kind:'orders'|'usage'|'audit'|'subscriptions') {
  const {limit,offset}=page(url,['userId']),filter=userFilter(url);
  const source=kind==='orders'?ORDERS:kind==='usage'?USAGE:kind==='audit'?'SELECT *,target_user_id AS user_id FROM admin_audit':
    `SELECT p.id,p.user_id,u.nickname,o.plan_id,o.label,o.daily_credits,o.max_claims,p.starts_at,p.expires_at,
      CASE WHEN p.revoked_at IS NOT NULL THEN 'revoked' WHEN p.starts_at>${NOW} THEN 'scheduled' WHEN p.expires_at<=${NOW} THEN 'expired' ELSE 'active' END AS status,
      (SELECT COUNT(*) FROM subscription_daily_claims c WHERE c.subscription_id=p.id) AS claims_count,p.created_at FROM subscription_periods p
      JOIN subscription_orders o ON o.id=p.order_id JOIN users u ON u.id=p.user_id`;
  const results=await env.DB.batch([env.DB.prepare(`SELECT * FROM (${source}) WHERE (? IS NULL OR user_id=?) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(filter,filter,limit,offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM (${source}) WHERE (? IS NULL OR user_id=?)`).bind(filter,filter)]);
  const items=results[0].results.map((r:any)=>kind==='orders'?{id:r.id,userId:r.user_id,nickname:r.nickname,provider:r.provider,mode:r.mode,kind:r.kind,currency:r.currency,
    amountMinor:r.amount_minor,...(r.currency==='usdt'?{amountScale:r.amount_scale}:{}),credits:r.credits,status:r.status,createdAt:r.created_at,paidAt:r.paid_at}:kind==='usage'?{id:r.id,userId:r.user_id,nickname:r.nickname,
      operation:r.operation,model:r.model,status:r.status,chargedCredits:r.charged_credits,reservedCredits:r.reserved_credits,providerCostUsd:r.provider_cost_usd,
      promptTokens:r.prompt_tokens,completionTokens:r.completion_tokens,billingExempt:r.billing_exempt===1,createdAt:r.created_at,finalizedAt:r.finalized_at}:kind==='audit'?publicAudit(r):
      {id:r.id,userId:r.user_id,nickname:r.nickname,planId:r.plan_id,label:r.label,status:r.status,startsAt:r.starts_at,expiresAt:r.expires_at,dailyCredits:r.daily_credits,claimsCount:r.claims_count,maxClaims:r.max_claims});
  return json(envelope(user,items,Number((results[1].results[0] as {n:number}).n),limit,offset));
}
async function mutate(request:Request,env:Env,user:UserRecord,target:string,kind:'credits'|'role') {
  const body=await readJson(request,2048),keys=['accountId','requestId','reason',kind==='credits'?'delta':'role'];
  if(Object.keys(body).some(key=>!keys.includes(key))||body.accountId!==user.id||typeof body.requestId!=='string'||!UUID.test(body.requestId)
    ||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>200||/[\0\r\n]/.test(body.reason))throw new ApiError(400,'请提供当前管理账户、请求编号和操作理由。');
  if(kind==='credits'&&(!Number.isSafeInteger(body.delta)||body.delta===0||Math.abs(Number(body.delta))>1000000))throw new ApiError(400,'每次调整必须是非零整数，范围为正负 1,000,000 Credit。');
  if(kind==='role'&&(body.role!=='user'&&body.role!=='super'))throw new ApiError(400,'账户角色无效。');
  if(kind==='role'&&body.role==='user'&&target===user.id)throw new ApiError(409,'不能撤销自己当前使用的 Super 权限。');
  const requestId=body.requestId.toLowerCase(),reason=body.reason.trim(),action=kind==='credits'?'credit_adjustment':'role_change',hash=digest(tokenFrom(request)!);
  const previous=await env.DB.prepare('SELECT * FROM admin_audit WHERE actor_id=? AND request_id=?').bind(user.id,requestId).first<AuditRow>();
  const matches=(r:AuditRow)=>r.target_user_id===target&&r.action===action&&r.reason===reason&&(kind==='credits'?r.delta===body.delta:r.role===body.role);
  if(previous&&!matches(previous))throw new ApiError(409,'该管理请求编号已用于其他操作。');
  let replayed=!!previous;
  if(!previous) {
    const id=`admin_${crypto.randomUUID()}`,nonce=crypto.randomUUID(),now=Date.now();
    const statement=kind==='credits'?env.DB.prepare(`INSERT INTO admin_audit(id,actor_id,target_user_id,request_id,action,delta,reason,processing_token,created_at)
      SELECT ?,?,u.id,?,'credit_adjustment',?,?,?,? FROM users u JOIN credit_usage_balances b ON b.user_id=u.id
      WHERE u.id=? AND u.is_guest=0 AND ${ACTOR} AND (? > 0 OR b.balance>=-?) AND ABS(b.granted_credits+?)<=1000000000000 ON CONFLICT(actor_id,request_id) DO NOTHING`)
      .bind(id,user.id,requestId,body.delta,reason,nonce,now,target,user.id,hash,body.delta,body.delta,body.delta):
      env.DB.prepare(`INSERT INTO admin_audit(id,actor_id,target_user_id,request_id,action,previous_role,role,reason,processing_token,created_at)
      SELECT ?,?,u.id,?,'role_change',u.role,?,?,?,? FROM users u WHERE u.id=? AND u.is_guest=0 AND ${ACTOR}
      AND (?='super' OR u.role<>'super' OR (SELECT COUNT(*) FROM users WHERE role='super' AND is_guest=0)>1) ON CONFLICT(actor_id,request_id) DO NOTHING`)
      .bind(id,user.id,requestId,body.role,reason,nonce,now,target,user.id,hash,body.role);
    const apply=kind==='credits'?env.DB.prepare(`INSERT INTO admin_credit_adjustments(audit_id,user_id,credits,created_at)
      SELECT id,target_user_id,delta,created_at FROM admin_audit WHERE id=? AND processing_token=?`).bind(id,nonce):
      env.DB.prepare(`UPDATE users SET role=? WHERE id=? AND EXISTS(SELECT 1 FROM admin_audit WHERE id=? AND processing_token=?)`).bind(body.role,target,id,nonce);
    const results=await env.DB.batch([statement,apply]);replayed=results[0].meta.changes===0;
  }
  const audit=await env.DB.prepare('SELECT * FROM admin_audit WHERE actor_id=? AND request_id=?').bind(user.id,requestId).first<AuditRow>();
  if(!audit) {
    const actor=await requireUser(request,env);if(actor.isGuest||actor.role!=='super')throw new ApiError(403,'Super 权限已改变，请重新登录。');
    const targetRow=await env.DB.prepare('SELECT is_guest FROM users WHERE id=?').bind(target).first<{is_guest:number}>();
    if(!targetRow)throw new ApiError(404,'账户不存在。');if(targetRow.is_guest)throw new ApiError(400,'游客账户不能调整 Credit 或提升权限。');
    throw new ApiError(409,kind==='credits'?'可用余额不足以完成扣减，或累计调整超出限制。':'必须保留至少一个 Super 账户。');
  }
  if(!matches(audit))throw new ApiError(409,'该管理请求编号已用于其他操作。');
  const current=await env.DB.prepare(`${USER_COLUMNS} WHERE u.id=?`).bind(target).first<UserRow>();
  return json({accountId:user.id,creditUnlimited:false,billingExempt:false,user:publicUser(current!),audit:publicAudit(audit),replayed},replayed?200:201);
}
export async function handleAdmin(request:Request,env:Env):Promise<Response|null> {
  const url=new URL(request.url),path=url.pathname;if(path!=='/v1/admin'&&!path.startsWith('/v1/admin/'))return null;
  const user=await requireUser(request,env);if(user.isGuest||user.role!=='super')throw new ApiError(403,'后台管理仅限 Super 账户。');
  if(path==='/v1/admin/overview'&&request.method==='GET'){if(url.search)throw new ApiError(400,'概览不接受查询参数。');return overview(env,user);}
  if(path==='/v1/admin/users'&&request.method==='GET')return users(env,user,url);
  for(const kind of ['orders','usage','audit','subscriptions'] as const)if(path===`/v1/admin/${kind}`&&request.method==='GET')return listing(env,user,url,kind);
  const match=/^\/v1\/admin\/users\/([^/]+)\/(credits|role)$/.exec(path);
  if(match&&request.method==='POST'){if(url.search)throw new ApiError(400,'管理操作不接受查询参数。');return mutate(request,env,user,targetId(match[1]),match[2] as 'credits'|'role');}
  throw new ApiError(match?405:404,'管理接口不存在或不支持此操作。');
}
