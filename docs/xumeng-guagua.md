# 叙梦呱呱商户

记录日期：2026-11-28。这是站主提供的呱呱（itxt002）商户资料，供对接和登录后台使用。代码里的下单地址已经是下面的创建订单接口，见 `cloudflare/dzmm/src/guagua.ts`。

登录成功后先改初始密码，并绑定谷歌验证码。

## 商户

| 项 | 值 |
| --- | --- |
| 商户名称 | 续梦ai |
| 商户后台 | http://ng9JyL0FSGD7tGBPfV.itxt002.xyz/ |
| 登录账号 | xumeng |
| 初始密码 | 123456 |
| 商户号 | M200147 |
| 商户秘钥 | 84526bf03dae2da8e8b236891055f33d |
| 回调 IP | 136.110.35.126 |

## 对接

| 用途 | 地址 |
| --- | --- |
| 对接文档 | http://ng9JyL0FSGD7tGBPfV.itxt002.xyz/#/publicapidoc |
| 创建订单 | http://RfBseViEKZlMAmu7ArWO.itxt002.xyz/api/services/app/Api_PayOrder/CreateOrderPay |
| 订单查询 | http://RfBseViEKZlMAmu7ArWO.itxt002.xyz/api/services/app/Api_PayOrder/QueryPayOrder |

下单和查单是 `POST`，正文为 `application/x-www-form-urlencoded`。创建订单字段包括 `mid`、`merOrderTid`、`money`、`channelCode`、`notifyUrl`、`sign`。签名是参数按 ASCII 排序后接 `&` 和商户秘钥，再做 MD5。回调来源 IP 为 `136.110.35.126`。
