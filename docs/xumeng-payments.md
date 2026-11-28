# 叙梦 / XUMENG 充值记录

当前状态（2026-10-05，Asia/Shanghai）：本站已部署 Z-Pay 人民币充值，配置为 `provider: "zpay"`、`mode: "live"`、`currency: "cny"`、`enabled: false`。套餐为 ¥28/88/188 对应 2,800/8,800/18,800 点；商户通道与凭据尚待登录后核实，未开放真实付款。详见 [Z-Pay 上线记录](xumeng-zpay.md)。呱呱商户资料见 [呱呱对接](xumeng-guagua.md)。历史 Stripe 数据与回调保留；当前未接聊天或模型扣费。

以下保存 2026-10-04 的 Stripe 真实模式准备和沙盒验收，所列版本、套餐与结果均为该历史阶段，并非当前 Z-Pay 上线结果。

## Stripe 真实模式准备（历史阶段）

- 业务 Worker 已部署为 `eef1e693-30a1-4e74-9dbc-4b9586147509`，前端版本为 `4d630b7b-609f-4fdd-bab9-c5d0da1cf092`；生产 D1 已应用 `0009_payment_modes.sql`，共 23 条命令。当前公开充值配置为真实模式、未启用，页面显示「真实收款尚未开通」。
- 真实 Stripe 主账户为 `acct_1UM3rVGsmSdUNsEh`。Dashboard 显示账户尚未激活、完成度 10%；[账户激活入口](https://dashboard.stripe.com/acct_1UM3rVGsmSdUNsEh/account/onboarding/business-structure) 尚未选择商户类型，公司、代表人、产品、公开信息、银行、安全与审核步骤均未开始。
- 后端支持独立的 `STRIPE_LIVE_SECRET_KEY` 与 `STRIPE_LIVE_WEBHOOK_SECRET`，并以 `STRIPE_LIVE_ACCOUNT_ID` 固定真实主账户。旧通用测试 Secrets 保留，用于处理既有沙盒订单回调；这些测试凭据不启用真实 Checkout。
- [真实模式配置脚本](../cloudflare/dzmm/scripts/configure-stripe-live.mjs) 只通过受信任的私有 stdin 接收凭据，先核对 `/account` 的账户与就绪状态，再写入真实模式 Secrets。脚本不发起扣款。当前没有取得 live key，也没有执行真实提供方修改、创建真实付款或完成真实模式端到端验收。
- 当前后端 **80/80 项测试通过，其中支付 19 项**；前端 **9/9 项检查**及 TypeScript 检查通过。沙盒历史测试结果继续按各自版本保留。

当前阻塞项为真实商户账户激活和对应正式凭据。[真实模式准备报告](../output/xumeng/payment-live-readiness-2026-10-04.json) 记录 `implementationDeployed: true`，同时 `providerConfigured: false`、`liveChargingEnabled: false`、`liveEndToEndVerified: false`。网站已切换到真实模式准备状态，配置禁用时不会创建正式 Checkout；沙盒验收通过不等同于正式支付已开放。

[真实模式只读 HTTP 验收](../output/xumeng/payment-read-only-verification-2026-10-03T21-34-44-467Z.json) **11/11 项通过**，记录 `mode: "live"`、`enabled: false`、`stateMutations: 0`。[浏览器验收](../output/xumeng/payment-live-browser-verification-2026-10-04.json) **6/6 项通过**，确认「真实收款尚未开通」、支付按钮禁用、USD 1/5/10 套餐、旧测试横幅已移除，以及模型扣费仍未关联；[当前充值页截图](../output/xumeng/payment-live-awaiting-activation-2026-10-04.png) 保存该界面。

[迁移完整性报告](../output/xumeng/payment-live-migration-integrity-2026-10-04.json) 确认模式迁移前后历史订单 4 条、通知 4 条、退款事实 1 条、账本 2 条的 SHA-256 均相同，账本序列为 5，外键违规为 0。当前准备阶段没有取得 live key，没有真实提供方修改、Checkout 或扣款；沙盒审计记录完整保留。

## 已完成的沙盒充值验收（历史阶段）

- 前端已实现套餐选择、正式账户登录门槛、服务器余额、近期订单、继续支付、支付返回核对与取消提示。
- 共享客户端已通过 **14/14 项 mock 边界检查**，记录在 [客户端校验报告](../output/xumeng/payment-client-verification-2026-10-04.json)。这些检查没有调用生产支付接口或修改生产记录。
- 初始充值部署的后端 **74/74 项完整 Worker/D1 测试通过，其中支付新增 13 项**。生产已成功应用唯一待执行的 `0008_payments.sql`（10 条命令），该阶段业务 Worker 版本为 `a4a90257-10a5-4856-a4c7-741e0c785ec9`。
- 充值前端已部署为 `5462c9b5-2e9f-4535-b1e3-2e7a497d4c31`；初始未配置阶段的生产 **11/11 项 HTTP 检查和 4/4 项浏览器检查通过**，确认测试模式、未配置说明、套餐切换与游客登录门槛。
- 沙盒阶段核对了 Stripe 测试账户 `acct_1ULLC6Gopt0xfgLI`，测试 Webhook `we_1UMYzxGopt0xfgLIEHlOPGH5` 的八类事件均已启用；测试 Secret Key 和 Webhook 签名密钥上传至业务 Worker Secrets。该阶段线上配置返回 `mode: "test"`、`enabled: true`，绑定后的 **11/11 项 HTTP 检查通过**。
- 实际提供方接入发现本站账户启用了 Managed Payments，创建本站 Checkout 需要显式设置 `managed_payments[enabled]=false`；Workerd 不接受 Stripe 请求的 `redirect: "error"`，后端已改用 `redirect: "manual"`。修复后业务 Worker 已部署为 `ecfcf0d5-fbcd-46a3-9692-93c0fc933708`，最终完整后端 **74/74 项测试**、直接支付 **13/13 项测试**及 TypeScript 检查通过；支付 13 项包含在完整后端 74 项中。
- 已通过网站为隔离的正式测试账户创建 USD 1 / 100 点数 Checkout，同请求编号重试返回同一订单与会话；在 Stripe 托管收银台使用官方 4242 测试卡完成付款，实际回调已收到，账户订单 API 确认 `paid`，余额由 0 增至 100。Stripe Dashboard 重投同一事件后余额保持 100，全额测试退款后余额恢复 0；D1 核对为一次购买入账与一次退款扣回。

该沙盒阶段的代码、数据库迁移、充值页面部署和测试密钥绑定均完成。实际 Stripe 测试 Checkout、付款、到账回调、重复投递防重与全额退款均通过，证据见 [沙盒提供方端到端验收](../output/xumeng/payment-provider-verification-2026-10-04.json)。该报告与对应 JSON 保留原有测试模式结果，不改写为真实模式验收。

## 用户流程

1. 用户从「充值」入口或「我的」页进入 `#recharge`。游客可查看后端公布的套餐，注册或登录正式账户后才能读取余额和创建订单。
2. 页面读取服务器套餐、模式和可用状态，用户单选后确认金额和充值点数。当前后端定义 USD 1 / 5 / 10 对应 100 / 500 / 1,000 充值点数；前端展示与提交均以 `GET config` 的实际套餐为准，不自行传入价格或点数。配置 `enabled: false` 时支付保持禁用。
3. 创建订单时提交套餐 ID、当前账户 ID 和 UUID 请求编号。失败重试复用该编号；后台与 Stripe 的幂等机制防止同一请求重复创建收银台。
4. 页面仅允许跳转到无用户信息、无非默认端口的 `https://checkout.stripe.com`。若返回订单的金额、币种或点数与用户确认的套餐不一致，页面要求刷新并重新确认，不自动跳转支付。
5. Stripe 成功返回 `/?payment_order=ORDERID&payment=success#recharge`；取消返回对应的 `payment=cancel`。查询参数不发放点数，也不代表付款成功。成功返回后页面每约三秒读取本人订单，最多核对约一分钟；超时可手动再次核对。
6. 只有服务器确认订单及入账后，页面才显示「已到账」和实际余额。取消仅表示用户退出支付页，不直接修改订单；未完成订单可继续支付或查看真实状态。

页面按服务器配置显示真实模式、测试模式或待激活说明。钱包余额按账户与支付模式隔离，旧测试余额不计入真实模式钱包；切换账户或离开页面会中止客户端读取，旧账户的返回结果不会应用到新账户。套餐单选使用原生 radio、fieldset 与 label；支付和刷新期间禁用重复操作。

## 接口

浏览器通过同源 `/api/backend/v1/payments` 访问现有业务 Worker。支付接口不写入角色、聊天或客户端备份 state。

| 接口 | 权限与结果 |
| --- | --- |
| `GET /config` | 匿名可读；返回 `enabled`、当前 `mode`、`testMode`、币种、套餐与说明；当前为 `live` / `false` / 未启用 |
| `GET /wallet` | 正式账户；返回 `accountId`、支付模式、该模式余额、累计充值/退款和本人近期订单 |
| `POST /checkout` | 正式账户；body 仅 `{ packageId, accountId, requestId }`，返回服务端订单和 `checkoutUrl` |
| `GET /orders/:id` | 订单所属正式账户；返回本人钱包及指定订单，其他账户不能读取 |
| `POST /api/payments/stripe/webhook` | Stripe 通知入口；前端网关按原始请求体和 `Stripe-Signature` 转发到后端 `/v1/payments/webhook` |

订单状态为 `pending`、`paid`、`partially_refunded`、`refunded`、`expired`、`failed`。金额以最小货币单位保存；点数、退款金额和退款点数由服务器决定。客户端数据校验拒绝账户/订单编号不匹配、无效支付地址、超范围退款和不可显示的日期。

## 服务器入账与退款

[支付后端](../cloudflare/dzmm/src/payments.ts) 支持隔离的测试与真实模式。创建 Checkout 前校验当前模式配置、正式账户与 `accountId`，从固定服务端套餐确定金额，并核对 Stripe 返回的环境、订单 ID、用户、套餐、币种、金额及点数 metadata。真实模式凭据未就绪时拒绝创建收银台。

[初始支付迁移](../cloudflare/dzmm/migrations/0008_payments.sql) 建立独立订单、通知事件、退款事实及充值账本；[模式迁移](../cloudflare/dzmm/migrations/0009_payment_modes.sql) 保留历史测试记录并增加模式隔离。Stripe session/payment intent 唯一；购买入账按订单唯一，通知事件和账本更新共同处理重复或并发投递。前端成功返回链接没有写账本的能力。

Webhook 校验原始请求体签名、时间、对应支付模式及账户，并复核 Stripe 对象与本站订单的关系；旧测试 Secrets 保留历史沙盒回调的处理能力。订阅事件包括 Checkout 完成、异步支付成功/失败、到期，以及退款创建、更新、失败和 charge 退款。已成功退款调整对应模式的充值点数；失败退款事实单独记录，处理乱序通知时不把失败退款当成成功退款。

更改套餐需要同时考虑后端配置、D1 套餐/金额约束和已创建订单；只改页面文案或客户端价格不改变真实 Checkout 金额。当前没有充值点数消费接口或自动聊天扣费。

## Stripe 沙盒配置（历史绑定与回调保留）

[配置脚本](../cloudflare/dzmm/scripts/configure-stripe-test.mjs) 通过 **stdin** 接收 JSON，字段为 `secretKey`，已有测试 Webhook 时另需 `webhookSecret`。脚本拒绝 live key，先核对预期自有 Stripe 账户，再创建或复用测试通知端点。创建请求使用固定目标测试账户的幂等键，防止同时配置产生重复端点；无法确认列表完整性或发现多个匹配端点时停止操作。

Webhook 地址为 `https://xumengchat.top/api/payments/stripe/webhook`。该沙盒配置脚本将 `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET` 直接经 Wrangler stdin 写入现有业务 Worker 的 Secrets；不把密钥放入命令参数、仓库文件或输出报告。历史验收使用 `STRIPE_PAYMENT_MODE=test`；当前准备状态使用 `live`，生产返回 origin 仍为 `https://xumengchat.top`。

历史沙盒阶段完成上述绑定，账户为 `acct_1ULLC6Gopt0xfgLI`，通知端点为 `we_1UMYzxGopt0xfgLIEHlOPGH5`。沙盒重新配置可在本机交互终端中使用不回显的输入方式；以下为交互式示例：

```sh
cd cloudflare/dzmm
python3 - <<'PY'
import getpass
import json
import os
import subprocess

# Require an interactive terminal before reading credentials.
terminal = os.open('/dev/tty', os.O_RDWR)
os.close(terminal)
credentials = {'secretKey': getpass.getpass('Stripe test Secret Key（不回显）: ')}
signing_secret = getpass.getpass('已有 Webhook Secret（首次创建可留空，不回显）: ')
if signing_secret:
    credentials['webhookSecret'] = signing_secret
subprocess.run(
    ['node', 'scripts/configure-stripe-test.mjs'],
    input=json.dumps(credentials), text=True, check=True,
)
PY
```

也可由受信任的本机凭据流程给 `npm run stripe:configure:test` 提供 stdin。不要把真实密钥写入 shell 参数、提交到代码、发送到聊天或放入浏览器变量。若测试通知端点已经存在，使用 Stripe 中对应的签名密钥继续配置；脚本不会通过创建重复端点来绕过缺失密钥。

本轮提供方核对使用 [Stripe 测试运维脚本](../cloudflare/dzmm/scripts/stripe-test-api.mjs) 与 [线上提供方验收脚本](../cloudflare/dzmm-web/scripts/verify-stripe-provider.mjs)。这两个一次性 CLI 通过 stdin 接收受信任流程提供的凭据，报告不包含密钥或 Cookie。账户的 Managed Payments 设置保留；本站 Checkout 请求显式关闭该会话的 Managed Payments，以沿用本站收款验证、Webhook 和独立账本流程。

## 沙盒验收记录（保留原始证据）

目前确定的客户端检查为 [14/14 mock 校验](../output/xumeng/payment-client-verification-2026-10-04.json)：精确 Stripe HTTPS 主机、凭据/端口拒绝、可变服务端套餐、账户隔离、重复请求编号、套餐变价确认、退款/日期边界、会话错误与请求取消。该报告标记 `mocked: true`、`productionRequests: 0`、`productionMutations: 0`。

初始充值部署的后端通过 **74/74 项完整 Worker/D1 测试，其中支付 13 项**；生产 `0008_payments.sql` 已应用，该阶段后端版本为 `a4a90257-10a5-4856-a4c7-741e0c785ec9`。沙盒修复后再次通过完整后端 **74/74 项测试**、直接支付 **13/13 项测试**及 TypeScript 检查，该阶段业务 Worker 版本为 `ecfcf0d5-fbcd-46a3-9692-93c0fc933708`。支付 13 项是该阶段完整后端 74 项的子集；模拟测试与下面的实际 Stripe 测试付款分开记录。

沙盒阶段前端网关完整测试 **37/37 项通过，其中支付网关新增 3 项**；配置脚本的缺失密钥、live key 与过短 test key 三项负例通过，均未发起网络请求。[沙盒部署汇总](../output/xumeng/payment-deployment-status-2026-10-04.json) 保存 74/37/14/11/4 各组结果、版本与迁移记录，该测试模式报告为 `providerConfigured: true`、`stripeEndToEndVerified: true`；`history` 保留初始未绑定阶段的两个 `false` 状态与空账本核对。

沙盒前端版本为 `5462c9b5-2e9f-4535-b1e3-2e7a497d4c31`。[沙盒生产 HTTP 验收](../output/xumeng/payment-production-verification-2026-10-04.json) 的结果为 **11/11 项通过**、`complete: true`、`stripeConfigured: true`。先前的 `stripeConfigured: false` 与四张支付表均为 0 条属于未绑定阶段，保留于沙盒部署汇总的 `history`；该阶段只读查询 `rows_written: 0`，没有创建 Checkout 或发起 Stripe 付款。沙盒绑定后的线上配置为 `mode: "test"`、`enabled: true`；HTTP 验收脚本不创建订单或付款，实际测试付款由独立提供方验收完成。

[浏览器验收](../output/xumeng/payment-browser-verification-2026-10-04.json) **4/4 项通过**：充值直接链接、测试模式与未配置说明、USD 5 套餐切换、游客登录弹窗。[充值页截图](../output/xumeng/recharge-page-2026-10-04.png) 保留该次界面证据；该检查没有提交支付或登录 Stripe。

可在 `cloudflare/dzmm-web` 使用 `npm run verify:payments` 重复执行 11 项只读/拒绝请求检查；该脚本不创建订单或付款。

实际 [提供方端到端验收](../output/xumeng/payment-provider-verification-2026-10-04.json) 已为隔离正式测试账户创建订单 `pay_ab62b744-69ac-458c-a3a1-a87e69581887`，同请求编号重试返回同一订单和 Stripe 测试会话。通过 Stripe 托管收银台使用官方 4242 测试卡支付 USD 1 后，实际回调到达本站；在 `2026-10-03T20:21:05.468Z`，本人订单 API 确认状态 `paid`、余额由 0 增至 100。

同一完成事件 `evt_1UMZQXGopt0xfgLIKKBwL9Gy` 在 `2026-10-03T20:22:33Z` 通过 Stripe Dashboard 实际重投，本站返回 HTTP 200 与 `{ received: true, processed: false }`，本人钱包保持 100。重投响应通过 Dashboard 实际 DOM 核对并记录于最终报告；[重投截图](../output/xumeng/payment-stripe-webhook-replay-2026-10-04.png) 保存操作界面，其渲染未完整呈现部分投递行文字。全额测试退款 `re_3UMZQVGopt0xfgLI0ad6O90h` 成功退还 USD 1（100 最小货币单位），订单变为 `refunded`、`refundedCredits: 100`；在 `2026-10-03T20:23:56.785Z`，本人钱包核对为 0。`refund.created`、`charge.refunded`、`refund.updated` 的实际 Stripe 投递均返回 HTTP 200。D1 核对有三个不同退款通知事件，购买账本仅一条 `+100`、退款调整仅一条 `-100`，净值为 0。

沙盒绑定后的生产配置为 `mode: "test"`、`enabled: true`，**11/11 项 HTTP 检查通过**；[沙盒充值页截图](../output/xumeng/payment-recharge-enabled-2026-10-04.png) 保存当时已启用的测试支付界面。接入排查阶段的旧 503 日志保留为历史诊断，诊断 Checkout 会话已过期且未扣款；这些日志不代表沙盒修复后版本的最终结果。

全额测试退款使该次测试钱包回到 0；支付订单、通知事件、退款事实和账本作为审计记录保留，没有删除支付记录。验收用登录会话已撤销，清理记录为 `sessionRevoked: true`、`auditRecordsPreserved: true`。这一历史验收仅覆盖 Stripe 测试模式，未验证真实付款或订阅。
