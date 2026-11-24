# 叙梦 Google / Telegram 登录配置与交接

更新时间：2026-10-10。本文记录配置准备与后续实现要求，不代表登录已经上线。

## 当前状态

- Google OAuth 客户端尚无创建成功证据；Google MFA 完成状态尚未收到用户确认。
- 用户报告已创建 Telegram Bot，公开用户名为 [@XumengChatbot](https://t.me/XumengChatbot)。这是用户报告，不是通过 Bot API 或登录流程完成的验证。
- Telegram 的 OIDC Login Widget Client ID / Client Secret、Allowed URLs 以及真实网页登录均未核对；Bot 创建成功不等于网页登录接入完成。
- 本次 Google 控制台访问停在 MFA 要求；用户需要亲自完成 Google 账号两步验证，之后才能继续配置。不要让他人代收或填写验证码、恢复码。
- 叙梦 Cloudflare 后端目前支持游客、邮箱密码、邮箱验证码登录，没有 Google 或 Telegram 登录接口。
- 仓库已有 Telegram 群反馈 Webhook，属于反馈功能；它不构成网页登录，也不证明任何登录凭证已配置。
- 以下两条回调地址是本次拟定配置，**回调尚未实现，直接访问或完成提供方配置都不能证明登录可用**。
- 本文没有保存 Client Secret、Bot Token、验证码或用户账号数据；没有创建绑定器、迁移数据库或发布产品。

本轮配置状态见 [setup-status.json](../output/xumeng/social-login-20261010/setup-status.json)，Google 阻挡页面见 [google-mfa-required.png](../output/xumeng/social-login-20261010/google-mfa-required.png)。首轮浏览器观察为 Google 尚未选择项目或创建客户端，Telegram 仅打开公开 BotFather 入口；此后用户已报告创建 `@XumengChatbot`。后续应分别记录用户报告、提供方配置核对与实际登录验收，不能把 Bot 创建或本文步骤当作 OIDC 接入完成记录。

## 本次填写值

| 项目 | Google | Telegram |
| --- | --- | --- |
| 网站源 | `https://xumengchat.top` | `https://xumengchat.top` |
| 精确回调 | `https://xumengchat.top/api/backend/v1/auth/google/callback` | `https://xumengchat.top/api/backend/v1/auth/telegram/callback` |
| 最小权限 | `openid email profile` | `openid profile` |
| 拟采用流程 | OIDC Authorization Code + PKCE | 新版 OIDC Authorization Code + PKCE |

网站源不带路径；回调保持完整 HTTPS 地址，不添加尾斜杠或 `#characters`。域名、端口或路径改变时，必须同步更新提供方登记与服务端配置。

## Google 配置步骤

1. 用户亲自完成当前 Google MFA 提示，再回到 [Google Cloud Console](https://console.cloud.google.com/)。
2. 创建或选择用户控制的项目，进入 Google Auth Platform。配置应用名称“叙梦”、真实支持邮箱和开发者联系邮箱；网站首页填写 `https://xumengchat.top`，授权域名填写 `xumengchat.top`。
3. 若面向普通 Google 用户，选择 External。先配置测试用户并保持测试阶段；开发测试与正式客户端按 Google 要求区分项目，正式项目只登记正式来源和回调。
4. 在 Data Access 中仅选择身份、邮箱、基本资料对应的权限；实现时请求 `openid email profile`。不增加 Drive、Gmail 等额外权限。
5. 在 Clients 创建 **Web application** OAuth 客户端。Authorized JavaScript origins 填上表网站源；Authorized redirect URIs 填上表 Google 精确回调。创建后由用户安全保管 Client ID / Client Secret，Secret 后续只注入服务端。
6. 后端实现与测试完成后，再处理正式发布与所需品牌/域名验证。提供方保存成功只表示客户端配置已完成。

Google 的客户端、回调与身份校验规则见 [Google OpenID Connect 官方文档](https://developers.google.com/identity/openid-connect/openid-connect)。

**隐私页待补充：** 现站没有可用作此配置的真正隐私政策页。已有 `/community-guidelines` 是社区规则，不能填作隐私政策。正式 Google 发布前，应补充并发布内容准确、公开可访问的隐私页，再填写其实际 URL；说明登录资料的用途、存储、共享、保留、删除及有效联系渠道，不承诺尚未实现的删除入口。Google 的生产应用要求可参见 [OAuth 生产准备说明](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)。

## Telegram 配置步骤

1. 用户在 Telegram 打开官方 [@BotFather](https://t.me/BotFather) **小程序**，选择用于叙梦登录的 Bot；若没有合适的 Bot，再创建。名称和头像应让用户能认出叙梦。
2. 进入 **Login Widget**。本次实际界面初始为旧版入口，显示 Enter URL 和 **Switch to OpenID Connect Login**；先切换至新版 OIDC。切换会创建或启用登录客户端凭证，使用电脑 UI 代操作时需要执行时确认，或者由用户亲自点击。当前尚未点击。
3. 在新版的 Allowed URLs 添加上表 Telegram 网站源和精确回调，两条都登记；不使用旧版单域名设置替代 OIDC 配置。
4. 在同一区域获取并安全保管 **Client ID / Client Secret**。这里的 OAuth Secret 不是 Bot Token，也不是现有反馈 Webhook Secret，不能互相代用。
5. 保持默认 RS256 签名，拟实现时仅请求 `openid profile`。本次不需要手机号或允许 Bot 私信的额外授权。
6. 后续实现服务端 code 交换及 ID Token 验证；当前没有可执行这些步骤的站内绑定器或回调。

本次依据 [新版 Telegram Login 官方文档](https://core.telegram.org/bots/telegram-login)，不是旧版 iframe Widget 的 `/setdomain` 与 Bot Token HMAC 接入。新版提供 OIDC discovery；Telegram 当前没有独立 UserInfo 接口，用户信息从已验证的 ID Token 获取。

## 凭证交接

提供方配置完成后，交接客户端是否创建、所选项目或 Bot、Allowed URLs、权限及发布状态即可。此文、Git、聊天、截图、浏览器存储和前端构建中都不要保存 Secret。不要把完整凭证页面或下载的 OAuth JSON 加入仓库。

Client Secret 应通过后续确定的 Cloudflare Worker 服务端 secret 配置注入；目前代码中没有这两类登录的环境绑定。Client ID 可作为公开配置，但仍需校验它与实际客户端及回调匹配。不要将登录凭证写入 `VITE_*` / `NEXT_PUBLIC_*`，也不要记录 code、ID Token、access token 或会话 Cookie。当前不需要长期访问提供方 API，不请求或持久化 refresh token。

## 后续实现范围

真正生产链路是 `src/components/dzmm/account-modal.tsx` → `src/lib/dzmm-cloud.ts` → `/api/backend/v1` → `cloudflare/dzmm-web/src/worker.ts` → `cloudflare/dzmm/src/auth.ts` → D1。`src/lib/auth.ts` 的 NextAuth / Prisma 是另一套登录，单独向它加入 Provider 不能接通叙梦。

| 文件或模块 | 需要处理的内容 |
| --- | --- |
| `cloudflare/dzmm/src/auth.ts` / 新增 OIDC 模块 | 提供方配置、启动、回调、显式关联、会话签发；当前通用 auth 路由只接受 POST，需支持精确 GET 路由 |
| `cloudflare/dzmm/src/types.ts` | 服务端配置类型与关联状态；不要提前声称环境项已绑定 |
| `cloudflare/dzmm/migrations/` | 新增外部身份映射和短时认证事务；复用 `users.id` 与 `sessions` |
| `cloudflare/dzmm-web/src/worker.ts` | 专用 OAuth 路由与安全重定向；现有通用代理会拒绝后端 3xx，且仅透传 `dzmm_session` Cookie |
| `src/lib/dzmm-cloud.ts` | 复用 `authenticateAccount` 的同步、备份、账户切换与加载状态流程；重定向前先完成游客待同步数据与本地备份 |
| `src/components/dzmm/account-modal.tsx` | 登录入口、配置不可用状态、取消与失败回显 |
| `src/lib/dzmm-account.ts` / `src/components/dzmm/profile-settings.tsx` | 已登录账号显式关联、关联状态与邮箱验证；Telegram 无邮箱时不能直接套现有密码表单 |
| `cloudflare/dzmm/src/signup-credits.ts` | 为真正首次注册的成功事务复用一次性 Credit 赠送约束 |

这些是待实施任务，不是已经修改的文件。

### 身份、关联与会话

- 通过验签后的 `iss` / Provider 与 `sub` 识别外部身份，保存唯一的 `(provider, provider_subject)` 到本地 `user_id` 映射。Google 邮箱、Telegram username、昵称或头像均不能作为身份主键。
- 新渠道登录不能凭同邮箱自动合并已有账号。已有邮箱账号应先按原方式登录，在账号安全中明确发起关联，并同时证明当前本地账号与外部身份的控制权；若该身份已绑定其他本地账号，拒绝静默重绑定或合并。
- Google 邮箱与现有 `users.email` 冲突时引导登录原账号后关联。`users.email` 已有唯一约束，不能直接插入冲突邮箱。Telegram 最小权限不提供邮箱，可创建邮箱为空的正式账号；以后按显式验证流程绑定邮箱。
- 新用户可在有效游客会话上原地升级，保留同一 `users.id` 的角色、收藏与会话。登录已有外部身份则加载它对应账号的记录；不自动将游客记录写入已有账号。
- 登录继续签发现有本地 `dzmm_session`，保留 HttpOnly、Secure、SameSite=Lax；提供方 token 不作为叙梦 Cookie 或浏览器持久凭证。
- 解绑需保证还有可用登录方式，并重新验证当前身份，避免用户失去账号入口。不存在的关联或解绑入口不能写成已可用。

### 认证事务与服务端校验

服务端为每次尝试生成随机 `state`、`nonce` 和 PKCE verifier（S256），建立短时、一次性事务，关联发起浏览器与原账户会话。回调必须核对提供方、准确回调、state、原账号/会话、nonce；一次消费，禁止重放。若认证期间账号切换、会话撤销或游客已被升级，结束当前尝试并要求重新发起。

服务端交换 code 后验证 ID Token 签名、允许的算法、`iss`、`aud`、有效期和 nonce，通过后才使用 `sub`。使用固定官方 discovery/JWKS 来源，处理密钥轮换。不要仅解码 JWT 就接受登录，不让用户输入的 URL 成为发现、换 token 或跳转目标。

新增 gateway 路由应只放行精确 OAuth 路径及已知提供方跳转，最终返回固定本站地址，并清理回调查询中的 code。现有账户修改仍保留来源检查；不能为接入 OAuth 全局关闭 CSRF 检查。若选择 state Cookie，需专门处理转发和清除；若存 D1，也必须绑定发起浏览器，只有 state 值相符不足以证明账号关联意图。

### 一次性 Credit

现有注册赠送为 1,500 Credit，使用 `trusted_credit_grants` 的 `new_signup:<userId>` 唯一键。新渠道只在真正新建正式账号或成功升级游客时，与用户、身份、会话写入同一事务赠送。已有账号登录、关联第二个渠道、回调重放、并发请求或重试不重复赠送，也不回填旧账号。不要重建用户来实现关联，否则既有购买、消费与内容所有权会分裂。

## 上线前验收

1. 配置未完成时入口明确不可用；配置完成但回调未实现时不能标注“已上线”。回调无 state、错误 state、取消、过期、重复、nonce 不符、错误签名/issuer/audience 均不能建会话。
2. 新身份首次注册、游客升级、同身份重复登录、两个提供方关联到同一本地账号分别验收。原角色、聊天、收藏、购买记录和余额保持正确归属。
3. 同邮箱的不同外部身份不得自动进入原账号；绑定时会话切换/撤销、身份已属其他账号必须拒绝。不同账号及多标签页的迟到响应不能覆盖当前草稿或泄露私人记录。
4. 新用户仅有一条注册赠送记录；已有账号登录、关联、重试与并发不增赠送。加载失败保留可恢复备份，不混合账户状态。
5. 检查 Secret/token 不出现在日志、前端产物、URL、localStorage 或 Git；回调精确匹配，redirect 不开放到任意域名，账号修改来源检查继续有效。
6. 隐私页与公开说明反映实际数据处理能力；Google 先用测试身份完成闭环，再处理正式发布。提供方配置、代码实现、预生产验证与正式发布分别记录证据。

下一步：Google 由用户先完成 MFA；Telegram 可直接选择已有 `@XumengChatbot`，进入 Login Widget 登记网站源与回调，不必等待 Google。提供方配置、准确隐私页及身份映射、事务、回调与显式关联可独立准备。隔离检查通过后再正式发布并核对真实登录；公开 Google 发布前需完成准确隐私页。任何一项未完成，都保留其待办状态。
