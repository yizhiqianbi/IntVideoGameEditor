# CCRent 域名方案

> 查询时间：2026-11-22（Asia/Shanghai）。可注册性用 IANA RDAP + whois 实时查询；价格取自 [TLDHub](https://tldhub.com/registrar/cloudflare) 的 Cloudflare Registrar 原价（2026-11-22 更新），最终以下单页为准。

## ✅ 已完成（2026-11-22）

| 项 | 状态 |
| --- | --- |
| `ccrent.cc` | 已购买并接入 Pages，HTTPS 生效（Google Trust Services 证书） |
| DNS | `CNAME @ → ccrent-dark.pages.dev`（Proxied） |
| Canonical | 六个页面的 canonical / og:url 均指向 `https://ccrent.cc` |
| `ccrent.dev` | 本次未购买，后续需要再加 |
| 访问 | <https://ccrent.cc> |

> ⚠️ 接入时使用了一个临时 DNS Token，任务完成后应在 <https://dash.cloudflare.com/profile/api-tokens> 删除（名称 `CCRent DNS`）。

## 一、结论：还买得到的品牌域名

| 域名 | 状态 | 首年 | 续费 | 适合 |
| --- | --- | --- | --- | --- |
| **ccrent.cc** | ✅ 可注册 | $8.00 | $8.00 | **首选主域**：短、和 Logo 的 C 呼应、便宜 |
| **ccrent.dev** | ✅ 可注册 | $8.20 | $12.20 | 开发者向别名，可信度高 |
| **ccrent.rent** | ✅ 可注册 | $50.20 | $50.20 | 语义最准（租用），适合做主域或跳转 |
| **claudecode.rent** | ✅ 可注册 | ~$50.20 | ~$50.20 | 产品关键词，SEO/投放用 |
| **ccrent.ai** | ✅ 可注册 | $80.00 | $80.00 | 品牌升级/面向 AI 客户 |
| **ccrent.io** | ✅ 可注册 | $32.00 | $50.00 | 开发者经典，但续费贵 |
| **ccrent.co** | ✅ 可注册 | $30.00 | $30.00 | .com 的备胎 |
| **ccrent.cloud** | ✅ 可注册 | $9.99 | $20.20 | 「云端 Mac」语义 |
| **ccrent.xyz / .top / .site / .online** | ✅ 可注册 | $13.50 / ~$1.2–4 / $4.99 / $4.99 | $13.50 / ~$4–7 / $27.70 / $27.70 | 廉价防御/跳转 |
| **ccrent.com.cn** | ✅ 可注册 | $5.39（Dynadot） | $5.39 | 中国大陆用户，需域名实名认证 |
| ccrent.one / ccrent.help | ✅ 可注册 | 待查 | 待查 | 备用 |

已经买不到 / 不建议：

| 域名 | 情况 |
| --- | --- |
| ccrent.com | 1998 年注册，GoDaddy 停放页，属于待售/保留域名，收购价通常 $1k+ |
| ccrent.org | **原站正在使用**（Cloudflare），不是我们的资产，不能动 |
| ccrent.net / ccrent.app | 2026-11-01 刚被注册（可能是同行或原站），不建议追 |
| macrent.com / rentcc.com / cc-rent.com | 已被注册 |
| cc.rent | 可注册，但两字符属于溢价域名，价格可能几百到上千美元，不建议 |

## 二、推荐组合

### 方案 A · 轻量起步（推荐，首年 ≈ $16）

| 域名 | 用途 |
| --- | --- |
| **ccrent.cc** | 唯一主域名，所有页面 canonical 指向它 |
| **ccrent.dev** | 开发者入口，301 到主域 |

优点：都是 Cloudflare Registrar 原价、一个账号里自动配 DNS、接 Pages 一键完成、续费便宜（$8 / $12.2）。

### 方案 B · 完整语义（首年 ≈ $116）

在方案 A 基础上加：

| 域名 | 用途 |
| --- | --- |
| **ccrent.rent** | 语义补充，301 到主域（$50.2/年，偏贵） |
| **claudecode.rent** | 产品关键词，301 到主域 |

### 方案 C · 品牌升级（首年 ≈ $196）

再加 **ccrent.ai**（$80/年），面向 AI 客户的品牌域名，建议直接做主站备选。

## 三、在哪买

### 路线 1：Cloudflare Registrar（推荐）

- 按成本价卖，无溢价、送 WHOIS 隐私、域名自动进当前 Cloudflare 账号
- 购买后我直接调 API 把它加到 Pages 项目，DNS/证书全自动，几分钟上线
- 缺点：需要你在 Cloudflare 后台手动下单（注册局接口不开放自助购买），且账号需绑定支付方式
- 入口：<https://dash.cloudflare.com/274d62c1f24b885b3dfe562cda5d60c1/domains/register>

### 路线 2：Porkbun / Namecheap（有 API，可全自动）

- 你提供 API Key（Porkbun 支持域名注册 API），并保证账户有余额/已绑卡
- 我可以自动购买 + 改 DNS 指向 Pages
- .rent 首年 Porkbun $3.84（续费 $52），.cc/.dev 价格接近
- 缺点：需要把 API 凭证交给我；之后建议把 NS 切到 Cloudflare 统一管理

### 路线 3：你自己在任意注册商买

- 买完把域名列表发我
- 我加进 Pages 自定义域，并给你需要配置的 CNAME / NS 记录

## 四、买完后怎么指向 Pages

1. 域名在 Cloudflare 账号内 → 我调用 `POST /accounts/{account}/pages/projects/ccrent-dark/domains` 添加，Cloudflare 自动创建 DNS 记录并签发证书
2. 域名在外部注册商 → 我加自定义域后，你在注册商处设置：
   - `CNAME @ → ccrent-dark.pages.dev`（根域名用 ALIAS/ANAME，或直接改 NS 到 Cloudflare）
3. 全部域名都会返回同一个站点；选定主域后我会：
   - 给六个页面加 `rel=canonical` 指向主域
   - 可选：加一个极小的 Pages Worker，把非主域 301 到主域（统一权重）

## 五、自动化脚本

```bash
# 查看 Pages 项目已绑定的自定义域
node tools/domains.mjs list

# 绑定域名（可多个）
node tools/domains.mjs add ccrent.cc ccrent.dev ccrent.rent

# 查询绑定状态 / 证书状态
node tools/domains.mjs status
```
