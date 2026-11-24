# 叙梦 USDT 会员与 NOWPayments 交接

2026-10-14 用户已确认：使用现有 USDT-TRC20 钱包，**15 USDT 买 3 个月（90 天）**。每个有效期内每日手动领取 **500 Credit**，每期最多 **90 次**，漏领不补；提前续订接续已有权益，不自动扣外部钱包。2026-10-13 曾确认的 5 USDT / 30 天方案只保留为历史订单快照。人民币、支付宝的新购不恢复，历史订单、会员和余额保留。

## 已完成与限制

商户后台已保存 Main wallet（USDT / TRX）与 Webhook `https://xumengchat.top/api/payments/nowpayments/ipn`。Webhook 已在离开标签后重新进入核对保存。用户确认后生成的 IPN 密钥和原有 API Key 只写入 `dzmm-backend` Cloudflare Secrets，元数据已确认存在；没有写前端、仓库或本地报告。临时凭据表单、监听器和内存已关闭，浏览器保存密码提示已拒绝。

北京时间 2026-10-14 04:52，已认证只读 `/currencies` 与 `/min-amount` 返回 HTTP200。`usdttrc20 → usdttrc20`、浮动、供应商费用由商户承担的组合最低金额为 **11.207792 USDT**，说明此前 5 USDT 月卡不适用。最低金额会变化，不能把这一次读数当永久报价或实际订单验收。

季度方案、动态最低金额预检查和历史回执兼容已发布。**收款仍关闭**：`NOWPAYMENTS_ENABLED=false`、`PAYMENTS_ACCEPTING_ENABLED=false`、`SUBSCRIPTION_ENABLED=false`，人民币前端入口仍停用。现有聊天扣费开关未改变。本轮没有正式订单、链上付款或模型调用；商户前期仅两次已认证只读请求。

后台已实际观察到 Custody 开启，但有效结算币种、实际商户费用、审核限制及供应商付款/IPN还未通过订单验证。浏览器验收在原生 Chrome 的 changed-app 保护中断，不能用 API/组件模块通过代替实际页面验收。真实付款必须由用户钱包操作；未完成这些验收前不自行开收款。

当前正式版本：

- 后端 `a19406e7-a963-4c3e-be07-300e17221eea`，schema38（后续仅投稿读取一致性、会话保存回执一致性修复；支付实现与开关未变）。
- 网页 `53ec25cb-333d-4808-bf75-e838646bac84`。
- 主 JS `/assets/index-BNlVrh95.js`，CSS `/assets/index-DZZpwjR_.css`。

以 [本轮发布证据](../output/xumeng/iteration/nowpayments-quarterly-20261014/release-status.json) 为准。已核对当前100%版本、Secrets名称元数据、正式匿名配置、冻结JS/CSS/RTC及零密钥命中；不能据此保证供应商或链上交易已经成功。

## 开放后的用户流程

1. 在“余额与权益”查看 **15 USDT / 90 天、每日500 Credit、最多90次**，登录自己的叙梦账号。
2. 确认币种与 TRC20 网络。服务器先核对实时最低金额，再创建一次原请求绑定的订单。
3. 使用本站收银台显示的**本订单地址和二维码**，按准确金额转账。钱包网络手续费另计；不能用固定商户结算地址替代订单地址。
4. 等待链上与服务器确认。少付、待确认或创建结果未知均不开通权益，禁止盲目重开订单或重复付款。
5. 确认开通后每日手动领取 Credit。提前续订会排到已有权益结束之后。

购买暂未开放时不显示可继续转账的收银台。原订单仍可登录所属账号只读恢复。

最低金额请求失败、无效、非正数、超出15，或者响应中存在错误币种字段时，在创建本地财务订单和供应商付款之前拒绝。客户端保留原 UUID；只有只读查询确认无订单、当前完整方案和网络完全一致时，才允许用户显式重试同一请求。已创建、结果未知或旧方案请求不会盲目重新POST。

## 不可变订单与金额

当前产品 `vip_quarterly` revision1，售价 `15000000` 个六位USDT最小单位，90天/每日500/最多90次。旧 `vip_monthly` 5 USDT/30天回执按保存的金额和权益核对，不用新目录改价。旧人民币回执仍是原30天方案。

采用 NOWPayments `POST /v1/payment`，固定实际 `pay_amount=15` 与 `pay_currency=usdttrc20`。辅助字段 `price_amount=15, price_currency=usd` 只为供应商估值，不能把15 USD当成本站USDT账务。返回的实际币种、金额、地址或编号不一致时不展示收银台。旧5USDT回调同样按其原快照核对。

仅服务器核对有效签名与足额 `finished` 事实后开通一次；重复、并发或乱序通知不重复发权益。退款及异常状态以服务器订单和会员状态为准。本站不猜测供应商未返回的托管发票URL。

## 服务器与入口

Secrets：`NOWPAYMENTS_API_KEY`、`NOWPAYMENTS_IPN_SECRET`，只在 `dzmm-backend`。不能放到 `VITE_*`、`NEXT_PUBLIC_*`，也不能打印值或要求用户在聊天发送密钥。

网络变量 `NOWPAYMENTS_PAY_CURRENCY=usdttrc20`。凭据缺失或网络无效时，即使误设开关为true也不创建订单。旧 `PAYMENT_PROVIDER=zpay` 留给历史处理，新通道独立，不能因接入NOWPayments重开旧通道。

回调 `POST /api/payments/nowpayments/ipn` 仅接受 HMAC-SHA512 签名 JSON；GET405只证明路由可达，不能证明真实供应商通知。前端业务API前缀 `/api/backend/v1/nowpayments`，包括 config、checkout、requests、orders、membership。一般账户写入继续保留来源和会话保护。

配置助手 `cloudflare/dzmm/scripts/configure-nowpayments.mjs` 通过私有stdin写Secrets，不启用收款。现有Secrets已配置，不要重复生成IPN密钥或重复写入来制造新版本。

## 迁移、验收与发布边界

0038已原子应用一次。迁移前保存只读Time Travel bookmark；固定聚合核对迁移前后8张财务表、金额、权益时长、领取、账本、序列、外键和精确schema定义一致。只查询聚合，没有读账户/私人会话明细。生产原3笔订阅订单、1个会员期间、2笔领取与账本、4个Zpay绑定均保留；NOWPayments生产订单仍0。

隔离实际D1验证了完整历史逐列保存、CAS、并发通知、失败整批回滚、原UUID重试、旧5/30存续、第31至90次领取、重复每日领取、续期接续和未知创建恢复。后端38个接受范围的测试文件合计518项通过；前端相关50项、独立跨层10组、分享Worker5项/24HTTP样本通过。未发布的publishing-snapshot修复与测试明确不纳入本次版本。

最终发布以已验收源码为底，另保留当前线上分享页Worker与9个逐字节验过的文件。发现外部7e版本使用旧dist回退媒体/USDT前端后，恢复此前已验收逻辑并合入季度方案；未发布工作区Vite预览/copy脚本或publishing.ts修复。显式保留 `/jump/index.html` 的307别名，无需复制未验的index静态文件。前端只构建一次，后端与网页各发布一次；正式21个支付/分享HTTP样本通过。

发生故障时先保持收款关闭，不删除其他进程锁或自动Time Travel恢复。产生季度数据以后不能回退0037或旧硬编码5USDT处理器，必须向前修复并保留已确认账本。固定迁移检查方法见 [ops说明](../output/xumeng/iteration/nowpayments-quarterly-20261014/ops/README.md)。

## 下一步

- 在稳定可操作的浏览器中验购买提示、刷新恢复、原请求重试和历史月卡显示；不要重复同一changed-app阻塞。
- 核对商户的有效结算、费用、审核及目标币种限制。
- 用独立供应商Sandbox配置，或用户本人明确选择的真实测试订单，验实际付款返回、IPN、足额/少付、重复通知、权益开通与续期。Sandbox不发生产权益，真实转账由用户钱包完成。
- 验收通过后独立授权启用NOWPayments；不恢复人民币/支付宝。

## 官方依据

- [API端点与参数](https://nowpayments.zendesk.com/hc/en-us/articles/21345824322717-API-and-endpoint-description)
- [最低金额说明](https://nowpayments.zendesk.com/hc/en-us/articles/27407237685917-Minimum-payment-amount)
- [商户集成设置](https://nowpayments.zendesk.com/hc/en-us/articles/21341613323421-NOWPayments-Integration-Guide)
- [IPN签名](https://nowpayments.zendesk.com/hc/en-us/articles/21395546303389-IPN-and-how-to-setup)
- [Sandbox指南](https://nowpayments.io/blog/how-to-use-the-sandbox-a-guide)
