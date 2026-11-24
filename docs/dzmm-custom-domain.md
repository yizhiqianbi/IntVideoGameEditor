# 叙梦 / XUMENG 自定义域名接入

核对日期：2026-10-04（Asia/Shanghai）。线上主入口为 [叙梦 / XUMENG](https://xumengchat.top/)。技术服务仍为 `dzmm-web`，业务后端为 `dzmm-backend`；D1/R2 沿用现有资源。当前充值已准备真实模式，公开配置为 `mode: "live"`、`testMode: false`、`enabled: false`，真实商户待激活。此前沙盒充值、图标、搜索跳转、首次品牌发布及初次域名绑定结果作为独立历史阶段保留。

## 当前真实充值准备

业务 Worker 已部署为 `eef1e693-30a1-4e74-9dbc-4b9586147509`，前端版本为 `4d630b7b-609f-4fdd-bab9-c5d0da1cf092`，生产 D1 已应用 `0009_payment_modes.sql`（23 条命令），测试与真实模式余额隔离。页面显示「真实收款尚未开通」，支付按钮禁用；当前后端 **80/80 项测试通过，其中支付 19 项**，前端 **9/9 项检查**及 TypeScript 检查通过。

真实 Stripe 主账户为 `acct_1UM3rVGsmSdUNsEh`，Dashboard 显示尚未激活、完成度 10%。[账户激活入口](https://dashboard.stripe.com/acct_1UM3rVGsmSdUNsEh/account/onboarding/business-structure) 尚未选择商户类型，公司、代表人、产品、公开信息、银行、安全与审核步骤均未开始。当前没有取得正式 live key，没有执行真实提供方修改或付款，也没有验证真实模式端到端支付。

后端支持独立的 `STRIPE_LIVE_SECRET_KEY` 与 `STRIPE_LIVE_WEBHOOK_SECRET`，以 `STRIPE_LIVE_ACCOUNT_ID` 固定真实账户；旧测试 Secrets 保留历史沙盒回调。真实模式配置脚本通过私有 stdin 接收凭据，先核对 `/account` 身份与就绪状态，再写入正式 Secrets，不发起扣款。公开配置 `enabled: false`，正式 Checkout 保持禁用；充值 Credit 与任务、邀请奖励统一进入聊天余额。当前准备与历史沙盒证据见 [充值与 Stripe 上线准备](xumeng-payments.md)。

[真实模式准备报告](../output/xumeng/payment-live-readiness-2026-10-04.json) 记录 `implementationDeployed: true`、`providerConfigured: false`、`liveChargingEnabled: false`、`liveEndToEndVerified: false`。[只读 HTTP 验收](../output/xumeng/payment-read-only-verification-2026-10-03T21-34-44-467Z.json) **11/11 项通过**，`stateMutations: 0`；[浏览器验收](../output/xumeng/payment-live-browser-verification-2026-10-04.json) **6/6 项通过**，确认待开通提示、禁用支付按钮、USD 1/5/10 套餐、旧测试横幅移除及模型扣费未关联。[当前充值页截图](../output/xumeng/payment-live-awaiting-activation-2026-10-04.png) 保留已核对界面。

[迁移完整性报告](../output/xumeng/payment-live-migration-integrity-2026-10-04.json) 确认历史订单 4 条、通知 4 条、退款事实 1 条和账本 2 条迁移前后的 SHA-256 均一致，账本序列 5、外键违规 0。真实模式准备没有取得 live key，没有真实提供方修改、Checkout 或扣款；此前沙盒 JSON 与审计记录保留。

## 已完成的测试充值部署（历史阶段）

[充值入口](https://xumengchat.top/#recharge) 与「我的」页入口已上线，使用同域支付 API 和原业务 Worker。初始充值部署后端版本为 `a4a90257-10a5-4856-a4c7-741e0c785ec9`，`0008_payments.sql` 已远程应用，完整后端测试 **74/74 项通过，其中支付 13 项**。充值 Credit 与任务、邀请奖励统一进入聊天余额，真实收款仍以当前生产配置为准。

初始未绑定阶段通过 **11/11 项 HTTP 检查**与 [4/4 项浏览器检查](../output/xumeng/payment-browser-verification-2026-10-04.json)，确认当时充值页、测试/未配置说明、套餐切换和游客登录门槛。初始 `stripeConfigured: false`、支付按钮禁用、未创建 Checkout 或付款及四张支付表均为 0 条，均属于未绑定阶段；该阶段只读查询 `rows_written: 0`，记录保留于 [部署汇总的 history](../output/xumeng/payment-deployment-status-2026-10-04.json)。[生产 HTTP 报告](../output/xumeng/payment-production-verification-2026-10-04.json) 已更新为绑定后 **11/11 项通过**、`stripeConfigured: true`。

沙盒阶段核对了 Stripe 测试账户 `acct_1ULLC6Gopt0xfgLI`，测试端点 `we_1UMYzxGopt0xfgLIEHlOPGH5` 指向 `https://xumengchat.top/api/payments/stripe/webhook`，八类通知事件均已启用。测试 Secret Key 与 Webhook Secret 存入业务 Worker Secrets，该阶段线上配置返回 `mode: "test"`、`enabled: true`，绑定后的 **11/11 项 HTTP 检查通过**。该账户的 Managed Payments 需要本站 Checkout 请求显式设置 `managed_payments[enabled]=false`；后端在 Workerd 中改用 `redirect: "manual"`。沙盒修复后完整后端 **74/74 项测试**、直接支付 **13/13 项测试**及 TypeScript 检查通过，支付 13 项包含在该阶段后端 74 项中；业务 Worker 版本为 `ecfcf0d5-fbcd-46a3-9692-93c0fc933708`。

已通过网站为隔离正式测试账户创建 USD 1 / 100 点数订单 `pay_ab62b744-69ac-458c-a3a1-a87e69581887`，同请求编号重试返回同一订单和会话。在 Stripe 托管收银台用官方 4242 测试卡支付后，实际回调到达本站；`2026-10-03T20:21:05.468Z` 的本人订单 API 核对为 `paid`，余额由 0 增至 100。同一完成事件经 Stripe Dashboard 在 `2026-10-03T20:22:33Z` 实际重投，返回 HTTP 200、`processed: false`，余额保持 100。全额 USD 1 测试退款成功后，订单为 `refunded`、退款点数 100，本人钱包在 `2026-10-03T20:23:56.785Z` 恢复为 0。三个不同退款通知均实际投递 HTTP 200；D1 中购买入账仅一条 `+100`，退款调整仅一条 `-100`。

实际测试 Checkout、测试付款、Webhook、重投防重和全额退款证据见 [沙盒提供方端到端报告](../output/xumeng/payment-provider-verification-2026-10-04.json)、[沙盒已启用充值页](../output/xumeng/payment-recharge-enabled-2026-10-04.png) 与 [Stripe Dashboard 重投界面](../output/xumeng/payment-stripe-webhook-replay-2026-10-04.png)。实际重投响应由 Dashboard DOM 核对并写入该阶段 JSON；重投截图的渲染未完整显示部分投递行文字。沙盒绑定后配置为 `mode: "test"`、`enabled: true`，**11/11 项 HTTP 检查通过**。旧 503 日志仅保留为接入排查历史，诊断会话已过期且未扣款。验收登录会话已撤销，支付审计记录保留，清理记录为 `sessionRevoked: true`、`auditRecordsPreserved: true`；一次性 stdin 运维与验收脚本的报告不含密钥或 Cookie。该历史阶段仅验证 Stripe 测试模式，未验证正式支付与订阅。

## 新品牌与路由契约

页面标题为「叙梦 · 角色与故事」，描述为「与角色相遇，让故事继续。」原创标记与图标见 [叙梦品牌](xumeng-brand.md)。角色作者、来源网址及原文校验信息保留，品牌更新不改写原站来源资料。

生产入口使用 `/`，旧 `/dzmm` 仅以 `308` 兼容跳转到 `/` 并保留查询参数；旧 [workers.dev 根入口](https://dzmm-web.850587960.workers.dev/) 仍可用。前端请求改用 `/api/chat`、`/api/backend/*`，旧 `/api/dzmm/*` 保留代理兼容。静态资源使用 `/assets/xumeng/*`，manifest 为 `/assets/xumeng/manifest.webmanifest`，其 `id`、`start_url`、`scope` 都为 `/`。本地 Next.js 的叙梦页面为 `/xumeng`，旧 `/dzmm` 跳转到它并保留查询参数；项目主首页不改为叙梦入口。

仓库静态资源继续存放在 `public/dzmm`，后台 Worker/service/env、`dzmm_session`、本地备份 key 及已存媒体 URL 保留兼容。展示层把旧静态/媒体地址映射到新路径，私人角色快照不进行批量改写；新入口仍通过原 Service Binding 使用已有数据库和 R2。

## 当前网页图标与 manifest

`/favicon.ico`、`/icon.svg`、`/apple-touch-icon.png`、`/apple-touch-icon-precomposed.png`、`/manifest.webmanifest` 和 `/site.webmanifest` 六个默认入口返回真实叙梦资源 `200`，不再进入 SPA 的 HTML 回退；缓存 300 秒后可重新验证。页面 head 使用根入口的 ICO/SVG、额外的原创 192px PNG favicon、Apple 图标与 manifest，现有 `/assets/xumeng/*` 品牌资源仍兼容。

此前图标修复版本为 `b0465cb0-3bcd-4950-b755-f00496b9cd12`。[该历史阶段网页图标报告](../output/xumeng/favicon-verification-2026-10-03.json) 记录 **48/48 项只读 HTTP 检查和 3/3 项浏览器检查通过**，确认真实图标/manifest 返回、head 图标声明、导航原创 Logo 实图加载和根 manifest。本地 **34/34 项测试通过**，类型、lint、build 通过。

## 搜索访问与关键词跳转（保留的契约）

`/nsfw` 与 `/porn` 是 unlisted（不列在导航）的关键词入口。`GET`、`HEAD` 均返回 `302`，跳到同一 origin 的 `/` 并保留查询参数，大小写和尾斜杠变体会统一处理。普通访客、Googlebot 和 Bingbot 获得相同跳转；这些入口不提供独立内容页。

主站设置 `index, follow`，canonical 为 `https://xumengchat.top/`，保留真实品牌标题和描述；OpenGraph 使用 `website`、`zh_CN` 和原创 512px 图标绝对地址，Twitter 使用 `summary`。`WebSite` JSON-LD 仅包含真实品牌名「叙梦」、英文别名「XUMENG」、网址和语言，不添加评分或虚构搜索能力。

`robots.txt` 使用 `Allow: /`，并声明主域名的 sitemap。sitemap 仅列 canonical 根入口，不列 hash 视图、跳转别名或新增角色 SSR 页面。本次范围遵循用户的「能搜到后跳主站」要求，没有扩展关键词内容页或公开角色 SEO 页面。

上一个搜索调整版本为 `e476840e-dfce-40c3-adb5-5989c6261bc5`。[该历史阶段的搜索与跳转验收](../output/xumeng/search-redirect-verification.json) 记录 `complete: true`、`readOnly: true`，**42/42 项检查通过**，覆盖主站索引 metadata、跳转及查询参数、爬虫与普通访客一致、robots/sitemap、现有资源与兼容 API；**3/3 浏览器检查通过**，确认 `/porn`、`/NSFW/` 跳转到主站，以及主站的索引声明、canonical 和自有品牌信息，最终恢复干净根入口。本地 **32/32 路由测试通过**，类型、lint、build 通过。允许抓取与跳转已验证，不代表搜索引擎已经实际收录或获得关键词排名。

## 购买选择

用户按低价优先，已选择并付款购买 `xumengchat.top`（叙梦）。Porkbun 域名管理页已确认注册完成，到期日期为 **2027-10-03**。此前单年购物车只有这一个域名，显示总价 $1.63 USD、预计续费 $4.63/年，没有添加邮箱或主机产品；该购买前报价记录保留在 [具体名称与购物车](../output/dzmm/domain-specific-prices-2026-10-03.json)，不改写为新的订单验证输出。

对比普通后缀官方价格：Cloudflare `.win` 首年促销 $4.18、续费 $5.18；Cloudflare `.com` 注册及续费均 $10.46。Porkbun `.top` 在这组已核实方案中首年与续费都更低。所有价格按观察日美元报价，之后的购买及续费仍以注册商订单为准。

来源：[Cloudflare 官方价格](https://pricing.registrar.cloudflare.com/)、[Porkbun .top](https://porkbun.com/tld/top)。更完整对比在 [域名研究](../output/dzmm/domain-registrar-research-2026-10-03.md)。

## 当前接入进展

以下为 2026-10-03 初次域名绑定阶段的最终确认状态，裸域已完成绑定与该阶段验收；新品牌发布结果单独记录。

| 项目 | 当前状态 |
| --- | --- |
| 域名注册 | Porkbun 已付款注册 `xumengchat.top`，到期 2027-10-03 |
| Cloudflare zone | 同一账户下的 Free zone `03dddcdde68df5142c80f173df4d1ecc` 已激活，Overview 显示域名已受 Cloudflare 保护 |
| 注册商 NS | 已保存并刷新回读 `arya.ns.cloudflare.com` 与 `hunts.ns.cloudflare.com` |
| DNS 传播 | 使用 Cloudflare 与 Google 的 DNS-over-HTTPS 查询 NS，均已读到上述新地址 |
| Worker 绑定 | Cloudflare Dashboard 已把裸域 `xumengchat.top` 绑定到现有 `dzmm-web` Production；Domains 列表及 Visit 目标确认新网址 |
| 本地部署配置 | `cloudflare/dzmm-web/wrangler.jsonc` 已加入实际 `custom_domain` routes，与已完成的 Dashboard 绑定一致；不需要为保存该配置再部署代码 |
| HTTPS 验收 | Universal 证书 **Active**；HTTPS 页面与 API 已通过，HTTP 返回 `301` 并保留原路径/查询参数跳到 HTTPS |
| `www` | 尚未配置 `www.xumengchat.top`，也没有为它配置重定向 |

注册、NS 更新、zone 激活、Universal 证书、Worker 裸域绑定及初次接入的 HTTPS/API/登录读取验收均已完成。现有 [workers.dev 根入口](https://dzmm-web.850587960.workers.dev/) 继续提供访问，D1/R2 沿用原资源；域名接入没有搬迁数据库或存储桶。

首次绑定后的短暂等待记录属于历史状态：当时注册商及两个 DNS-over-HTTPS 解析器已经读到新 NS，但 zone 仍为 Pending、HTTPS 访问失败。后续已确认激活和证书 Active，该等待状态不再是当前阻塞项。

## 绑定现有 Worker 的配置

1. 确定并购买具体域名。Cloudflare Registrar 使用 Cloudflare nameservers；其他注册商先在 Cloudflare 添加 zone，并把注册商 NS 改为该 zone 实际给出的两条 nameserver。
2. 检查同名 hostname 已有的 DNS/邮件配置，避免覆盖其他用途。等待目标 zone 为 Active，并在此后确认 HTTPS 与业务入口实际可用。
3. 进入 `Workers & Pages → dzmm-web → Settings → Domains & Routes → Add → Custom Domain`，填写最终 hostname。Cloudflare 会建立相应 DNS 与 TLS 证书。
4. 绑定整个 hostname，例如裸域或 `chat.<实际域名>`。网站使用 `/`、`/api/*`、`/assets/xumeng/*`，并兼容旧 `/dzmm/*`；只绑定 `/dzmm/*` 会遗漏新入口、API 和资源。采用 Custom Domain，不把它简单 CNAME 到 workers.dev。
5. 选择裸域与 www 中的一个主入口。先保留旧 workers.dev，完成注册账户、角色、图片、论坛、流式聊天验证后再处理重定向。

以下实际域名配置已写入 `cloudflare/dzmm-web/wrangler.jsonc`；Cloudflare Dashboard 的绑定已完成，此配置保留该映射供后续正常版本部署使用。本轮没有为域名绑定另行重新部署前端代码。

```json
"routes": [{ "pattern": "xumengchat.top", "custom_domain": true }]
```

目标是 `dzmm-web`；浏览器始终通过同域的前端网关访问 API。裸域作为主入口，`www` 若需要另行绑定或重定向。

官方：[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)、[Worker 权限](https://developers.cloudflare.com/workers/authorization/workers/)。早期 Wrangler 登录记录未显示 zone/Workers Routes scopes；本轮已通过同账户 Cloudflare Dashboard 创建 zone 并实际绑定 Production Worker，随后完成激活与可用性验收。该历史 CLI 权限观察不影响此次已确认的绑定结果。

## 登录与已有数据

前端 API 都使用相对地址，网关根据实际 request URL 校验 Origin，再通过 Service Binding 访问后端。给 dzmm-web 接新域名不需要把新域名加入后端 `APP_ORIGINS`。

会话 cookie 是 host-only、HttpOnly、SameSite=Lax、Path=/，HTTPS 下 Secure。新域名、www/裸域和某些独立应用窗口有各自的登录状态。正式账户在新入口重新登录同一账号即可读取现有 D1/R2 数据。游客应先在旧 workers.dev 注册并完成同步，再切换入口；否则新域名会创建另一个游客身份。浏览器本地备份也按 origin 隔离。

## 首次新品牌发布验证（历史阶段）

首次品牌发布版本为 `2067e3a1-bd5c-4a06-ae52-5a8625f73a3e`。[该阶段品牌与路由验收](../output/xumeng/branding-routes-verification.json) 已记录 `complete: true`、`readOnly: true`，38/38 项通过，覆盖当时的叙梦 HTML/原创资源、新 manifest、旧链接兼容跳转、新旧 API 兼容、隐藏说明页 `404`/robots，以及缺失资源不会误返回应用页面。本地 **63/63 项测试通过：31 项 Worker/路由/资源、32 项角色/媒体/存储**，类型、lint、build、dry-run 通过。上传返回路径兼容仅通过 mock smoke 核对；没有在线创建或删除媒体。

同一报告的生产浏览器 **9/9 项检查通过**，确认叙梦标题/Logo、旧入口跳转保留 query/hash、52 张页面图片使用新地址完整加载、新 manifest、安装页原创图标、现有游客会话与任务中心、创作入口及最终干净根入口，1029px 视口无横向溢出。当时隐藏说明页的 HTTP `404` 已在上述 38 项中完整核对，未将不稳定的浏览器导航计为通过项；该旧入口行为已被上方的关键词 `302` 跳转取代。这些结果不声明已完成系统 PWA 安装。

## 初次域名绑定后的验证

[初次新域名 API 报告](../output/dzmm/custom-domain-api-verification-2026-10-03.json) 的 **19/19 项检查通过**，覆盖当时的 HTTPS 健康状态、`/` 与 `/dzmm` 页面、JS/CSS/图标/封面、同源 manifest、实际模型配置、公共角色目录、匿名任务 `401`、外源请求 `403`、安全 Cookie、既有账户与 D1 状态一致，以及 HTTP `301` 保留路径和查询参数。这是品牌更新前的绑定阶段证据，不验证新 `/dzmm` 的 `308`、新 API 别名或新图标。

旧入口与新入口分别登录同一个现有 Super 账户，返回相同账户 ID、state 哈希与 version，证明新域名仍连接同一套已有 D1 数据。Cookie 验证为 Secure、HttpOnly、SameSite 与 host-only；两个临时登录会话均已撤销。本轮没有私人业务记录写入、任务领取或付费模型请求，也没有读取私人媒体；模型配置可读不等同于本轮发起了聊天生成。

[初次域名绑定总记录](../output/dzmm/custom-domain-binding-2026-10-03.json) 包含当时的新域名浏览器 **6/6 项通过**：六项任务中心、安装页、创作入口、51 张角色卡与 52 张页面图片全部加载、同源 manifest，以及 1280px 视口无横向溢出。该浏览器记录不声明系统已完成 PWA 安装，也不是本轮新品牌发布的浏览器结果。

本轮仅绑定裸域。`www.xumengchat.top` 仍未配置，旧 workers.dev 没有被关闭或重定向。原 workers.dev 上的早期 API/浏览器结果继续作为各自历史来源的验证记录。当前真实充值准备、账户激活阻塞项与已完成沙盒验收见 [充值与 Stripe 上线准备](xumeng-payments.md)；图标、搜索调整、首次品牌发布与初次绑定阶段的记录分别保留，不作为当前版本的验证结果。
