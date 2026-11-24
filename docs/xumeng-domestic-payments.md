# 叙梦境内支付接入评估

核验日期：2026-10-04。当前仅完成官方资料研究、代码审阅和线上配置只读查询；尚未选择渠道、申请商户、调整生产数据库或开通真实收款。用户的个人／个体工商户／企业主体类型待确认。

## 建议路线

优先核验支付宝电脑网站支付与手机网站支付，以覆盖桌面网页和手机浏览器；再接微信 Native 扫码。此为接入建议，实际可申请产品、域名要求和经营类目需要对应商户平台确认。

| 主体与渠道 | 核验结果 |
| --- | --- |
| 个体工商户＋微信 Native | 官方支持，需要认证 AppID 与商户号；适合电脑页面展示订单二维码。 |
| 个体工商户＋微信 H5 | 当前官方权限列表不支持。企业等主体可另行申请。 |
| 个人无执照＋微信服务商小微 | V3 进件包含线上经营字段，但须由已获权限的普通服务商进件并接受真实资料审核；不能保证纯线上 AI 对话额度适用。 |
| 企业账号＋支付宝 AI 订阅 | 官方支持指定经营类目、订阅及单笔支付；须审核开通，费率取决于基础支付产品合同。 |
| 普通支付宝网站支付 | 已找到官方入口，但最新准入正文依赖 JavaScript，本次未独立核验个体支持方式、备案及主体一致性细则；进入商户平台后确认。 |

微信 Native 明确不支持相册或长按识别付款二维码，不能视为单手机浏览器体验的完整替代。微信网页收款官方页面要求网站域名完成 ICP 备案，H5 申请还要求备案截图。部署在 Cloudflare 不能代替这些产品审核要求；当前资料没有给出支付 API 调用必须从大陆服务器发出的限制。

申请微信支付本身免费，官网概述交易费率为 0.6%–1%，叙梦实际费率须依核准类目确定。支付宝 AI 方案亦以签约的基础支付产品费率为准，不承诺统一 0.6%。

个人收款码、线下当面付和网站订单自动充值属于不同产品场景，不以线下材料代替网站业务审核。提交资料时应如实描述 AI 对话、额度使用与退款方式，不自行认定为某个收费更低的类目。

若需办理 ICP 备案，域名后缀、注册商资质、实名和主体一致性也要核验。现域名此前在 Porkbun 购买，不能只因为已绑定 Cloudflare 就认定能备案；需按接入商要求核实是否需要转入获批注册商，以及符合条件的大陆云资源。

## 当前系统与改造边界

2026-10-04 04:43 UTC 查询公开配置：`mode=live`、`enabled=false`、`currency=usd`、`modelBillingLinked=false`，套餐 USD 1／5／10；正式商户尚未启用。

- 后端 `cloudflare/dzmm/src/payments.ts` 绑定 Stripe Checkout、Stripe 通知和固定美元套餐。新增渠道需要单独的下单、查单、退款及签名验证适配。
- `0009_payment_modes.sql` 的订单与退款币种约束仅允许 USD，套餐与点数关系也固定。人民币以整数分记账，使用新的套餐身份和支付渠道字段；不能改写历史美元订单或混用沙盒余额。迁移必须保留完整订单、通知、退款与账本图及序列。
- 前端 `src/lib/dzmm-payments.ts` 及 `src/components/dzmm/recharge.tsx` 仅允许 Stripe 托管收银台地址。需要按渠道区分跳转／二维码，并保持账户、套餐、金额和模式校验。
- 网关 `cloudflare/dzmm-web/src/worker.ts` 只有 Stripe 独立通知入口。新渠道应有精确回调路由、原始请求体与必要签名头转发；普通用户写入接口保留同源保护。
- 只有支付方签名、商户身份、订单金额与币种核验通过，才原子入账；支付返回页、截图、客户端“已支付”均不发点数。重复回调只入账一次，退款调整同样需幂等。
- 充值余额当前未参与聊天计费。正式销售额度前，还需确定模型消耗计价、服务端扣点、失败调用处理、退款与对账流程。

启用条件：主体及业务审核通过、相应产品签约、正式凭据安全绑定、回调与退款联调、小额真实支付与余额验收通过。研究结论不代表已具备收款能力。

## 官方来源

- [微信 Native 产品介绍](https://pay.wechatpay.cn/doc/v3/merchant/4012791874)
- [微信各主体基础支付权限](https://pay.wechatpay.cn/doc/v3/merchant/4015477838)
- [微信 H5 申请与域名资料](https://pay.wechatpay.cn/doc/v3/merchant/4012791841)
- [微信网页收款与备案](https://pay.wechatpay.cn/static/partner_ability/web_payment.shtml)
- [微信 V3 小微进件](https://pay.wechatpay.cn/doc/v3/partner/4012722249)
- [微信 PC 网站申请与费用](https://pay.wechatpay.cn/static/applyment_guide/applyment_detail_website.shtml)
- [支付宝网页应用接入流程](https://open.alipay.com/module/webApp)
- [支付宝电脑网站支付准入入口](https://opendocs.alipay.com/open/270/01didh?ref=api)
- [支付宝手机网站支付准入入口](https://opendocs.alipay.com/open/203/107084?ref=api)
- [支付宝 AI 订阅准入与计费](https://aipay.alipay.com/docs/subscribe/introduce.html)
- [阿里云备案域名核验要求](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/prepare-and-check-the-domain-name)
