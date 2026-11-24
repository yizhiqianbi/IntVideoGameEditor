# 叙梦 Z-Pay 人民币充值

核对日期：2026-10-05（Asia/Shanghai）。人民币充值、模型消费账本及前后端已部署。已在登录后的 Z-Pay 后台核实支付宝通道 24745 为「已签约」且开启；商户凭据已通过官方接口验证，并经私密 stdin 上传到既有 Worker Secrets。

生产 `ZPAY_ENABLED=true`，API 已返回 `enabled=true`，充值页已显示支付宝与 ¥28／88／188 套餐。已创建一笔未付款的 ¥28 订单；浏览器已成功进入 `https://api.z-pay.cn/pay.html`，显示「叙梦 AI 对话充值点数 · 2800 点」、¥28.00 与支付宝付款二维码。站主已选择暂时不付款，待付款订单保留，实际到账尚未验证。Z-Pay 商户余额核对时为 0 元，当前能正常创建这笔收银台订单，无预存提示；尚未验证付款后的服务费处理。未代站主付款或给商户账户充值。[实际收银台](../output/xumeng/zpay-live-cashier-2026-10-05.png)。

## 套餐与功能边界

| 人民币金额 | 充值点数 | 套餐 |
| --- | --- | --- |
| ¥28.00 | 2,800 | cny_28 |
| ¥88.00 | 8,800 | cny_88 |
| ¥188.00 | 18,800 | cny_188 |

用户于 2026-10-05 指定以上新档位，延续每元 100 点。新档代码与 `0012_zpay_recharge_tiers.sql` 已通过验证并部署。旧 ¥1/5/10 档从当前下单目录移除，历史订单仍按创建时冻结的金额、点数及商品名处理。

金额以整数分保存，由服务端固定套餐决定。只有实际配置的支付宝／微信通道出现在充值页；`ZPAY_ENABLED=true`、正式凭据及至少一个通道同时满足时才允许创建订单。

充值 Credit 与任务、邀请奖励进入同一聊天余额；模型调用扣费基础已接入，费率由服务端策略控制。月订阅仍待定价并保持关闭。详见[模型 Credit 账单](./xumeng-credit-billing.md)。Z-Pay 退款需要管理员人工处理并核对，尚不提供自动退款闭环。支付方查询 `status=0` 表示未支付，不能据此撤销已到账 Credit。

## 支付与到账

登录正式账户后创建订单，服务端返回与本人订单绑定的本站收银地址。该页面生成签名表单 POST 至支付方。API key 留在 Worker Secrets 中，不进入浏览器、源代码、仓库或验收文件。

`notify` 验证提供方签名、商户身份、支付方式、金额、商品及订单绑定，再通过 D1 原子事务和唯一账本入账。重复或并发通知只记一次；`return` 仅清理支付方参数并返回本站，不改余额。未到账订单可向官方接口主动查单补偿漏通知。

| 路由 | 用途 |
| --- | --- |
| `/api/backend/v1/payments/config` | 配置、已配置支付方式、固定人民币套餐 |
| `/api/backend/v1/payments/checkout` | 本人、渠道、方式、套餐与幂等编号绑定的下单 |
| `/api/payments/zpay/checkout/zp_UUID` | 本人订单的签名 POST 表单，或相同已到账订单的返回跳转 |
| `/api/payments/zpay/notify` | 精确公共 GET 回调，无浏览器会话依赖 |
| `/api/payments/zpay/return` | 精确公共 GET 返回，仅跳本站充值页 |
| `/api/backend/v1/payments/wallet` | 本人正式充值余额及订单 |
| `/api/backend/v1/payments/orders/ORDER_ID` | 本人订单核对；未到账 Z-Pay 订单可主动查单 |

相关实现：`cloudflare/dzmm/src/zpay.ts`、`payment-wallet.ts`、`cloudflare/dzmm-web/src/worker.ts`、`src/lib/dzmm-payments.ts`、`src/components/dzmm/recharge.tsx`。

## 生产配置与历史保全

生产变量：`PAYMENT_PROVIDER=zpay`、`ZPAY_ENABLED=true`，有效密钥及支付宝通道已绑定。私密配置脚本 `cloudflare/dzmm/scripts/configure-zpay.mjs` 只从 stdin 接受 PID、API key 与通道 ID，验证凭据后上传既有 Worker Secrets；它不改变开户资料、不创建付款、不修改启用变量。余额接口成功仅验证凭据；通道签约状态另由已登录的商户页面核实。

实际接口兼容性：同一凭据查询余额时，`Accept: application/json` 返回未包含官方成功字段的封装；`Accept: */*` 返回官方 `code=1` 与合法余额。凭据配置和主动查单采用后者，仍严格验证 JSON、大小及商户／金额／订单身份。支付表单的 `form-action` 仅允许原提交域名 `https://zpayz.cn` 和实际观察到的收银台域名 `https://api.z-pay.cn`；不开放任意 HTTPS 跳转域名。

生产已应用 `0011_zpay_payments.sql`（8 条命令），创建独立订单、通知、账本与人工退款状态表，不重建或修改 Stripe 四张历史支付表。迁移前后订单 4 条、事件 4 条、退款 1 条、账本 2 条的哈希完全一致，账本序列保持 5、外键违规为 0。正式钱包合并同一用户的 Z-Pay 与 Stripe live 点数；Stripe 沙盒订单与余额继续隔离，历史 Stripe 回调保留。

当前业务 Worker 版本 `62a778e5-ca32-4e4a-884a-f529eac7bf2c`；前端 Worker 版本 `2b3083b8-ecf1-439e-af6d-7815e186232a`，自定义域名 `xumengchat.top` 部署成功。网关已绑定专用 `BillingService` 并设置每分钟账务维护。首次接入版本和旧套餐迁移证据保留为历史。邮箱登录绑定保持启用。本次收银台验收创建了一笔 ¥28 待付款订单，没有代用户付款、模型消费或退款。

部署前 Time Travel bookmark：`0000006d-00000000-000050fa-0528a83a40f3c0a1207e15dec2c2aee7`。只读迁移快照脚本 `capture-payment-integrity.mjs` 在内存中计算旧支付数据指纹，输出仅包含哈希、行数与统计，不保存支付地址或凭据。

新档迁移前 bookmark：`00000079-00000000-000050fa-9190f341679380bd8af7103156c58a72`。`before tiers` 快照覆盖 Stripe 与 Z-Pay 八张表及两套账本序列；生产 Z-Pay 四表暂无订单或到账记录，序列尚不存在。

新档生产迁移 `0012_zpay_recharge_tiers.sql` 成功应用 23 条命令；迁移前后八张表全部指纹及两套序列完全一致，外键违规为 0。旧表约束保留历史三档并扩展新三档；当前后台目录仅提供新三档。新档部署后生产支付只读检查 17/17 通过。

## 验收

- 本次新增 `0015_credit_usage.sql` 成功应用 8 条命令；迁移前后 16 张既有表（支付、订阅、聊天）指纹和统计一致，外键违规为 0。[迁移前](../output/xumeng/credit-usage-migration-integrity-before-2026-10-05.json)与[迁移后](../output/xumeng/credit-usage-migration-integrity-after-2026-10-05.json)。新消费请求、消费流水、Z-Pay 订单和到账流水均为 0。
- 最终后端 161/161，其中 Z-Pay 22 项，覆盖实际请求头与收银台跳转域名兼容性；Credit 账务 18 项实际 D1／命名 Worker RPC 检查。网关 73/73、共享处理器 42/42、支付／订阅／账单客户端 50/50，类型、相关 lint 与正式构建通过。均使用模拟支付／模型响应，不代表实际到账验收。
- 密钥绑定和最新业务发布后支付只读检查 17/17，通过 `EXPECTED_PAYMENT_ENABLED=true` 强制断言开放状态；Credit 查询与写接口隔离 11/11，订阅只读检查 10/10。浏览器确认 ¥28/88/188 套餐与实际 ¥28 支付宝收银台。一次性充值已启用，聊天扣费和月订阅保持关闭。

以下为此前接入与新充值档位的历史验收：

- 支付客户端 mock 验证 17/17，通过账户、渠道、支付方式和跳转地址边界；Cloudflare 客户端 TypeScript 通过。
- Web 网关完整测试 42/42，涵盖精确回调路由、凭据隔离、原始参数、大小限制和安全返回；Worker TypeScript 通过。
- 当前全套后端 117/117 通过，其中 Z-Pay 安全用例 20/20，覆盖并发通知、防重复到账、错金额／身份、事务回滚、查单补偿、历史隔离与迁移保全，以及三档新金额和旧价格回调。TypeScript 通过；首次接入的真实 workerd MD5、UTF-8、随机数与恒时比对检查通过。
- 私密凭据配置脚本的三项负例均在外部请求／上传前拒绝，且不打印输入。
- 生产只读支付检查 17/17、邮箱登录检查 10/10 通过。公开配置为 Z-Pay、CNY、live、未启用；伪造与未签名通知无法入账，私有订单需要登录，返回地址会清除提供方参数。检查不创建会话、订单、充值或邮件。
- 新档浏览器已确认 ¥28/88/188 显示为 2,800/8,800/18,800 点，选择 ¥88 后摘要与套餐一致，配置未启用时按钮仍禁用，旧邮箱登录会话仍能读取本人余额。[当前截图](../output/xumeng/zpay-recharge-tiers-2026-10-05.png)。首次上线 ¥1/5/10 的[历史截图](../output/xumeng/zpay-recharge-awaiting-channel-2026-10-05.png)保留。
- 此前历史验收未发起真实支付或退款。当前真实签约通道及 ¥28 收银台已验收；用户手动付款和实际到账回调仍待验证。

私密配置与迁移快照脚本已强制关闭 Wrangler 文件日志并启用脱敏，不继承可能关闭脱敏的用户环境选项。KEY 已绑定，不写入本地文件、命令参数、环境变量或验收记录；绑定脚本只输出脱敏后的配置结果。原本机安全绑定标签页已切换到充值页。

官方来源：[Z-Pay 开发文档](https://www.z-pay.cn/doc.html)。
