## 当前状态：正式收款被门店审核阻止（2026-10-15）

用户在正式站遇到拒单后，实际签名的 `checkout/create-session` 返回 HTTP 403、`layer=order`、`Store is not approved for production payments`。Pancake 业务详情向导也显示尚需提交门店审核。**入口开关、生产密钥及商品已经配置，不代表门店已获准收款。** 当前不能提示用户反复付款；必须先完成真实审核条件。

- 后端已发布 `dfb8f4ae-4bf8-4ed3-90ea-0ed312f5107a`：错误信息只按白名单分类；修复 ISO `expiresAt` 和 `autoRenew:false` 与前端解析契约不一致的问题。38 项定向测试、后端类型检查通过。
- 已按用户确认的资料推进至业务审核第 8/12 步；联系邮箱已验证，网站域名及正式政策页待验证。尚未提交审核、尚未获得批准。
- `/pricing`、`/terms`、`/privacy`、`/refund-policy`、`/support` 已做成本地草稿，6 项定向页面路由测试和客户端类型检查通过，完整 Web 构建通过；**尚未发布或生效**。正文见 [政策草稿](xumeng-payment-policy-draft.md)。页脚入口在草稿标志解除后才出现。
- 官网 `/.well-known/waffo-verify.txt` 验证文件已准备但未发布；本次挑战到 2026-10-16 16:28（北京时间）有效，过期须在 Waffo 界面重新生成，不能假定旧值有效。
- 官方 AIGC 要求与现有生成前后审核、真人参考行为合成和成人模板存在待解决差距；已请用户确定实际产品方向，未修改生成开放状态，也未作“已符合”申报。
- 当前生产公开配置在浏览器中仍为 live / enabled / CNY 28 / 30 天 / 每日 100 Credit / 手动续购。普通 HTTP 检查收到 403，不能以此冒充页面功能验收；浏览器回读证据另存。
- 本轮仅 1 次真实供应商创建收银台诊断请求被拒，创建会话 0、订单 0、付款 0、模型调用 0。没有修改密钥、价格、会员权益、收款开关或生产账号数据。

证据：[本轮记录](../output/xumeng/iteration/waffo-production-rejection-20261015/round.json)。下方 Sandbox 与开放入口记录为历史过程，不能替代当前状态。

---

## 当前 Sandbox 验收结果（2026-10-15）

已用隔离测试账户完成一条端到端 Sandbox：CNY ¥28 一次性商品 `PROD_6qtAqxNAbrc7CjIHyy74wP` → 中国地区 WeChat Pay 测试收银台 → 模拟成功 → `order.completed` 签名 Webhook → 叙梦订单回执。Waffo 投递记录显示 HTTP 200、`processed:true`，叙梦回执为 `paid`、30 天权益已建立、每日 100 Credit、手动续期（`autoRenew:false`）。这次没有真实付款。

验收结束后已删除隔离测试账户及其订单、会员期和领取记录（远端计数均为 0），删除 Sandbox 账户白名单 Secret，并关闭 `WAFFO_SANDBOX_ACCEPTANCE_ENABLED`。当前远端配置为 `enabled:false`、`collectionEnabled:false`；前端入口仍关闭，生产 Webhook 未配置。

证据：[Sandbox 验收记录](../output/xumeng/iteration/waffo-sandbox-acceptance-20261015/round.json)。

# 叙梦 Waffo Pancake 接入（Sandbox）

历史观察记录：2026-10-14T14:53:29Z（当前验收见文首 2026-10-15 记录）

- 个人 Pancake 商户：`STO_5jP1wkwwsG1S2uDGTEaoG8`
- 历史测试商品：叙梦 VIP（仅用于早期支付方式观察）
- 历史产品 ID：`PROD_39KdxDIZLuGrholqLli3Wh`
- 历史价格：USD 5.00 / 月，订阅
- 收银台：测试模式，不产生真实扣款
- 当前展示：银行卡、Apple Pay、Google Pay；未展示 WeChat Pay
- 生产收款：未开通，叙梦全局收款仍关闭

Waffo 的公开说明显示支付方式由支付模式、买家地区、币种、交易类型和商户资格共同决定；WeChat Pay 在平台目录中存在，但当前订阅测试收银台没有展示。不要据此把 WeChat Pay 视为已接通。若要验证微信，需要先确认它是否支持该订阅方案；更稳妥的验证方式是用户明确要求后创建单独的一次性 Sandbox 商品，再观察地区/币种矩阵。

密钥不写入本文档，不放前端或聊天。

## 中国地区二次核对

中国地区买家在同一 USD 5/月订阅收银台继续后，实际仍只展示银行卡、Apple Pay、Google Pay，WeChat Pay 未出现。当前观察排除了“地区选成美国”的单一原因；仍不能从收银台单独确定是订阅类型、USD 币种、Waffo 商户资格还是支付矩阵规则导致。未勾选同意、未点击订阅、未产生测试或真实扣款。

## CNY 一次性 Sandbox

- 商品：叙梦 VIP 人民币月卡
- 产品 ID：`PROD_6qtAqxNAbrc7CjIHyy74wP`
- CNY ¥28.00，一次性购买（每月需手动续购）
- 中国地区收银台已打开；需要买家自己填写邮箱后才能进入支付方式页
- 未提交支付、未同意条款、未开启生产收款

## CNY 微信 Sandbox 验收

- 中国地区 CNY ¥28 一次性收银台已显示微信二维码支付步骤。
- 页面明确为测试模式，不处理真实付款；仅观察二维码与支付模拟按钮，未点击成功/失败、未接受条款。
- 结论：Waffo 微信支付在 CNY 一次性商品的 Sandbox 路径可见；CNY 自动订阅仍未支持/未验证。

## 叙梦后端适配状态

已在 Cloudflare Worker 中加入服务端适配并完成关闭状态部署，入口为：

- `GET /v1/waffo/config`：只返回公开的开关、环境和套餐信息，不返回密钥。
- `POST /v1/waffo/checkout`：正式账户通过 Worker 创建 Waffo authenticated checkout，固定商品、CNY 和微信方式；请求带幂等键，收银台令牌只放在响应 URL fragment。
- `POST /v1/payments/waffo/webhook`：保留原始请求体，校验 `X-Waffo-Signature`（RSA-SHA256、45 分钟重放窗口），再按订单、商品、CNY ¥28 和事件 ID 幂等落库并开通 30 天权益。
- `GET /v1/waffo/requests/:requestId`：仅允许当前登录账户读取自己的订单快照，便于从收银台返回后恢复订单状态。

迁移 `cloudflare/dzmm/migrations/0043_waffo_cny_membership.sql` 扩展现有订阅订单图，保留历史 Z-Pay/NOWPayments 数据；后台订单会显示 `provider=waffo`、`mode=sandbox`。适配器代码已就绪，但默认 `WAFFO_SANDBOX_ACCEPTANCE_ENABLED` 未开启且全局 `PAYMENTS_ACCEPTING_ENABLED` 也未开启，因此不会创建订单或开通权益。沙盒验收时只允许在 `WAFFO_ENVIRONMENT=sandbox` 下打开前者；生产收款仍必须同时满足全局开关。沙盒凭据已经通过 Cloudflare Secrets 写入 `dzmm-backend`（仅记录变量名，不记录密钥值）：`WAFFO_PRIVATE_KEY`、`WAFFO_MERCHANT_ID`、`WAFFO_API_BASE_URL`、`WAFFO_STORE_ID`、`WAFFO_PRODUCT_ID`、`WAFFO_WEBHOOK_TEST_PUBLIC_KEY`。Worker 已部署到 `https://dzmm-backend.850587960.workers.dev`，`GET /v1/waffo/config` 应继续返回 `enabled:false`、`collectionEnabled:false`，直到显式打开 Sandbox 验收闸门。

Waffo Pancake Sandbox 的 Webhooks 页面已配置测试回调：`https://dzmm-backend.850587960.workers.dev/v1/payments/waffo/webhook`，当前监听测试事件；未配置生产回调，也未开启生产收款。迁移 `0043_waffo_cny_membership.sql` 已在远端 D1 应用，旧 Z-Pay/NOWPayments 数据保留。

前端增加了关闭状态的 Waffo 校验客户端和功能闸门 `XUMENG_WAFFO_FRONTEND_ENABLED=false`，不会在当前页面显示收款入口。待一次 Sandbox 订单、签名 Webhook、幂等核销和会员查询完成验收后，才能单独打开 Waffo；密钥不可发到聊天或前端。

## 生产收款已配置（2026-10-15）

用户确认继续配置生产 Waffo 后，已在已登录的 Pancake 商户后台完成以下步骤：

- 生产 API 密钥已创建，私钥下载到本机桌面 `/Users/pencil/Desktop/waffo-production-private-key.pem`，文件权限为 `0600`；私钥内容未进入前端、日志或聊天，剪贴板已清空。
- 生产商品已创建并处于销售中：`PROD_5PMLNpxGgmuZhnReQKZf7W`，CNY ¥28，一次性购买 30 天，用户手动续订。
- 生产 Webhook 已指向 `https://dzmm-backend.850587960.workers.dev/v1/payments/waffo/webhook`，仅监听 `order.completed`；生产公钥仅写入后端 Secret `WAFFO_WEBHOOK_PROD_PUBLIC_KEY`。
- 后端已切换为 Waffo live 配置，`PAYMENTS_ACCEPTING_ENABLED=true`、`WAFFO_ENABLED=true`、`WAFFO_ENVIRONMENT=live`；旧 Z-Pay 入口保持关闭，NOWPayments 仍关闭。
- 网页已打开 Waffo 生产卡片，显示 Live、CNY ¥28、100 Credit/日、30 天和“前往生产收银台”；未发起真实订单、未执行真实付款。

远程配置回读：`GET /api/backend/v1/waffo/config` 返回 `mode=live`、`enabled=true`、`collectionEnabled=true`；Waffo 生产入口已实际出现在正式页面。正式 Waffo 私钥的 RSA-2048 本地格式校验通过。证据：[生产开放轮次](../output/xumeng/iteration/waffo-production-open-20261015/round.json)。

生产商户首页仍显示 Waffo 的生产资质审核提示；这不阻止后台商品和入口配置，但真实收款是否能在商户审核完成前成功扣款，尚未执行真实交易，保持未知。开放后首笔订单应由用户自行确认金额并完成付款，服务器仅在签名 Webhook 核验后开通权益。
