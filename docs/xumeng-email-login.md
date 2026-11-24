# 叙梦邮箱验证码登录

前端调用本站 `/api/backend/v1/auth/email/*`，Cloudflare 网关通过既有 Service Binding 转发至 `dzmm-backend`。账户、验证码挑战和会话保存在既有 D1；角色、聊天、收藏和充值余额继续属于原账户。密码登录与注册保留。

## 接口与账户行为

| 接口 | 行为 |
| --- | --- |
| `GET /v1/auth/email/config` | 返回真实配置状态、600 秒有效期和 60 秒重发间隔；不创建会话或发送邮件 |
| `POST /v1/auth/email/request` | `{email}`；只有发信服务接受邮件后才返回 `challengeId`，不返回验证码 |
| `POST /v1/auth/email/verify` | `{email,challengeId,code,nickname?,accountId?}`；有当前会话时必须提交其账户 ID，避免其他标签页改变 Cookie 后误升级账户 |
| `POST /v1/auth/password` | `{accountId,currentPassword,newPassword}`；账户 ID 与当前会话一致才能设置密码；成功返回同一账户 ID |

验证码由加密随机数生成；D1 只保存绑定邮箱及挑战 ID 的 HMAC-SHA256。有效期十分钟，最多五次失败尝试，同邮箱一分钟内不能重发；新挑战使旧挑战失效。另有限制邮箱和 IP 请求频率的数据库计数。验证码消费、账户选择及会话签发在一个 D1 事务内完成。

新邮箱可升级当前游客，保留原用户 ID 和记录；已有邮箱加载原账户，游客数据保留在其自身备份中。用户输入不能设置 Super 权限。首次验证旧版未验证邮箱时，会清除尚未证明属于邮箱持有人的旧密码，并撤销此前会话；邮箱持有人可在“设置 → 账号安全”设置新密码。已验证账户的后续验证码登录保留现有密码。

前端验证前先保存游客更改，验证后按账户 ID 加载数据。验证码响应丢失、超时、取消或格式不合法时暂停同步，重新核对会话后才继续；账户 ID 不匹配时不写入另一账户。更改邮箱会取消当前发信请求并清除旧挑战。未配置或发送失败时不会显示发送成功。

## Cloudflare 发信配置

用户选择 Cloudflare 原生发信。Workers Paid 基础费为 $5/月；Email Sending 每月包含 3,000 封，超出后 $0.35/千封。账户结账页另外列出了 Workers、D1 等产品的用量超额费用。依据：[Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)、[Email Service 定价](https://developers.cloudflare.com/email-service/platform/pricing/)。

发信域名为 `auth.xumengchat.top`，发件人 `noreply@auth.xumengchat.top`。用户已自行完成 Workers Paid 支付；发信子域名已通过官方 Wrangler 开通，SPF、DKIM、DMARC 与三个邮件路由 MX 记录已核验，主站继续沿用现有部署。控制台确认域名 Enabled、DNS Configured，已发送 1 封；账户当前每日发送上限为 200 封，与每月套餐包含额度分别限制。

生产配置为 `cloudflare/dzmm/wrangler.production.jsonc`：

- `EMAIL_PROVIDER=cloudflare`。
- `EMAIL_FROM=noreply@auth.xumengchat.top`。
- 生产环境 `EMAIL_AUTH_ENABLED=true`；本地配置仍为 `false`，避免本地调试误发真实邮件。
- `send_email` 的 `EMAIL` 绑定仅允许该发件人，用户邮箱不设固定收件人白名单。
- `EMAIL_OTP_SECRET` 是私有随机密钥，仅保存在 Cloudflare Worker Secrets。密钥不得写入仓库、客户端或日志；更换密钥会使先前挑战失效。

```sh
cd cloudflare/dzmm
npx wrangler email sending enable auth.xumengchat.top --zone-id 03dddcdde68df5142c80f173df4d1ecc --config wrangler.production.jsonc
npx wrangler email sending settings auth.xumengchat.top --config wrangler.production.jsonc
npx wrangler email sending dns get auth.xumengchat.top --config wrangler.production.jsonc
npm run check
npm test
npm run deploy:production:dry-run
npm run db:migrate:remote
npm run deploy:production
```

代码另支持可选 Resend 通道：设置 `EMAIL_PROVIDER=resend`、已验证域名的 `EMAIL_FROM` 和 Worker Secret `RESEND_API_KEY`，其余挑战和会话逻辑相同。用户本次选择原生 Cloudflare，未注册、配置或启用 Resend。该通道只能从后端固定请求官方发信 API，不将密钥或服务商原始错误返回前端。

## 验证与部署状态

迁移 `0010_email_auth.sql` 只新增邮箱验证时间字段及验证码挑战、重发预约表，不批量修改旧密码、会话或记录。首次成功验证邮箱时才会根据上述规则更新该邮箱账户。

部署前已记录 D1 Time Travel 恢复书签 `0000005d-00000000-000050fa-1d4277721c5c67caf5b5aa675c069909`。该书签保留时间取决于 Cloudflare 当前套餐，不应在有新生产写入时直接恢复整个数据库。

```sh
cd cloudflare/dzmm-web
npm run check
npm run test:web
npm run deploy
npm run verify:email
```

`verify:email` 只检查已部署页面、资源、配置、方法约束、来源约束和未登录的数据隔离，不发送邮件或创建账户。验证结果会写入 `output/xumeng/email-auth-read-only-*.json`；该检查不能证明邮箱收件成功或完成真实验证码登录，二者应单独记录。

2026-10-04 已部署前端版本 `8dcb4583-11df-4bcb-891d-4f6ee0a672b2`、后端版本 `7de86675-16da-4d79-881e-09fff121da3b`，并应用 `0010` 迁移。97 个后端测试、28 个客户端测试和 37 个网关与资产测试通过。初始关闭状态通过 12 个生产只读检查；启用后使用 `EXPECTED_EMAIL_AUTH_ENABLED=true npm run verify:email`，10 个生产只读检查通过。迁移前后账户、会话、私有角色、聊天、订单及入账流水的聚合数量一致；该检查不等同于对所有私有记录逐条计算哈希。

已完成一封真实验证码邮件的发送、用户收件和网站登录。此次将原游客就地升级为已验证邮箱账户，用户 ID 不变、权限仍为普通用户；挑战只消费一次，刷新页面后会话仍有效，云端同步完成。“账号安全”已显示首次设置密码入口；用户尚未设置密码，本次也未为用户预设密码。这次游客原有私有角色和会话数为零，非空数据保留由本地事务测试及迁移检查覆盖。

部署与真实登录报告为 [email-auth-readiness-2026-10-04.json](../output/xumeng/email-auth-readiness-2026-10-04.json)，启用状态检查为 [email-auth-read-only-2026-10-04T04-24-47-543Z.json](../output/xumeng/email-auth-read-only-2026-10-04T04-24-47-543Z.json)，发信 DNS 为 [email-domain-verification-2026-10-04.json](../output/xumeng/email-domain-verification-2026-10-04.json)，迁移证据为 [email-auth-migration-integrity-2026-10-04.json](../output/xumeng/email-auth-migration-integrity-2026-10-04.json)，已登录界面为 [email-login-success-2026-10-04.png](../output/xumeng/email-login-success-2026-10-04.png)，密码设置入口为 [email-password-setup-2026-10-04.png](../output/xumeng/email-password-setup-2026-10-04.png)。
