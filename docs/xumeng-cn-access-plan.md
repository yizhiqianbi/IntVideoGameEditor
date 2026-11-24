# 叙梦国内访问与「镜像站」方案

日期：2026-11-19（Asia/Shanghai）
范围：`xumengchat.top` / `xumengcat.top` 的国内可访问性与镜像架构建议
状态：决策建议；本次未改动任何线上配置

## 0. 先给结论

1. **字面意义的「境内镜像站」（境内服务器 / 境内 CDN 节点）做不了**，而且不是钱和工期的问题：备案、内容（站点自述含成人内容）、生成式 AI 合规、支付与主体资质四道硬约束，任何一条都过不去。详见第 2 节。
2. **能做且值得做的是「不落境内」的国内加速入口 + 兜底入口**：
   - **P0（今天，¥0）**：Cloudflare 静态资源缓存与协议调优；
   - **P1（推荐，¥25–60/月，约 0.5–1 天）**：香港轻量服务器做 `cn.xumengchat.top` 中继，静态资源在港缓存，API / SSE / WebSocket 透传回 Cloudflare；
   - **P2（兜底，¥0–20/月）**：独立域名 + 静态只读落地页，防主域被墙时「全网失联」。
3. **域名先对齐**：`xumengcat.top` 目前**未注册**（whois 无记录、DNS NXDOMAIN），线上主站是 `xumengchat.top`。若「xumengcat」是笔误，按 `xumengchat.top` 规划即可；若你确实想把它做成备用/镜像域名，第 6 节给了注册与接入步骤。

## 1. 现状核查

### 1.1 域名与托管

| 项目 | 观测值 |
| --- | --- |
| 主站 | `https://xumengchat.top/` → HTTP 200，HTTP/2，TLS 1.3，Cloudflare `colo=HKG` |
| DNS | NS 为 `arya.ns.cloudflare.com` / `hunts.ns.cloudflare.com`，DNS 与代理都在 Cloudflare |
| 注册 | `xumengchat.top` 在 Porkbun 注册，2026-10-03 注册，2027-10-03 到期 |
| ICP | 页脚未见备案号；注册商与托管均在境外 |
| `xumengcat.top` | whois.nic.top「object does not exist」，DNS NXDOMAIN，即**未注册、可注册** |

### 1.2 资源与缓存（2026-11-19 实测）

| 资源 | 原始体积 | gzip 后 | 响应头 |
| --- | --- | --- | --- |
| 首页 HTML | 12.1 KB | 4.1 KB | `public, max-age=0, must-revalidate`，cf-cache-status HIT |
| 主 JS `/assets/main-*.js` | 550.6 KB | 177.3 KB | 同上，cf HIT |
| 主 CSS `/assets/main-*.css` | 198.9 KB | 35.7 KB | 同上，cf HIT |

**问题**：文件名带哈希，本来可以一年强缓存，现在却是 `max-age=0`，回头客每次站内跳转都要多一轮协商请求。跨境链路抖动时，这一轮协商就是几百毫秒。

### 1.3 链路抖动（口径见下）

连续 6 次直连首页：TLS 握手 44–259 ms，TTFB 81–657 ms；其中 1 次 TLS 握手失败、1 次 5 秒超时。主 JS（177 KB gzip）多次请求的 TTFB 在 365–1453 ms 之间波动。`/api/backend/health` 未登录返回 401、TTFB 240 ms；`/api/health` 404 用时 1.29 s。

> 口径说明：本机存在多条出口，Cloudflare 侧看到的来源 IP 在香港（`103.156.242.226`），**这批数字不代表大陆各省真实体验**，只用于说明链路本身抖动明显。正式验收要做大陆多省探测，见第 7 节。

### 1.4 架构事实（来自仓库，决定方案可行性）

- 前端是 **Cloudflare Workers + Static Assets**（`run_worker_first` + SPA fallback），API 同源 `/api/*`；后端是 service binding（`dzmm-backend`）、Durable Objects（直播）、Containers（女友聊天）、R2 媒体、D1 数据。
- 登录态是 `dzmm_session` Cookie，且 `src/lib/xumeng-session-cookie.ts` 已把会话提升到父域 `.xumengchat.top`（当前 `HOSTS` = `xumengchat.top`、`create.xumengchat.top`）。**这意味着子域中继可以沿用同一登录态，不需要改登录逻辑。**
- 多个写接口强制校验 `Origin === 自身 origin`（`worker.ts:254`、`live-gateway.ts:45`、`companion-gateway.ts:117`、h3 通道等）。所以中继必须把浏览器发来的 `Origin: https://cn.xumengchat.top` 改写成 `https://xumengchat.top`，否则登录后的写操作会 403。
- 限流和地区判定用到 `CF-Connecting-IP` 与 `request.cf.country`：经中继后这两个值会变成香港出口（副作用见 5.6）。

## 2. 为什么「境内镜像站」不可行

按卡死顺序：

1. **内容红线（决定性）**。站点首页自述「包含成人内容、18 周岁」，且存在 `/nsfw`、`/porn` 等入口。境内 IDC/CDN 接入都要过内容审核；腾讯云 EdgeOne 官方限制明确「涉黄内容」会被屏蔽，情节严重的停止服务。境内传播淫秽色情内容的刑事风险不再展开。[腾讯云 EdgeOne 使用限制](https://edgeone.ai/zh/document/63620)
2. **备案**。境内服务器 / 境内 CDN 节点必须先 ICP 备案。Cloudflare 中国网络要求：企业版套餐 + 单独购买中国网络订阅 + 提供 ICP 备案号 + 京东云逐域内容审核 + 页脚展示备案号；EdgeOne 加速区域选「中国大陆境内」或「全球可用区」同样要求备案（未备案只能选「全球可用区（不含中国大陆）」）。当前域名在境外注册商，备案主体、域名实名、接入商审核都要从头来。[Cloudflare China Network 接入要求](https://developers.cloudflare.com/china-network/get-started/)
3. **生成式 AI 合规**。向境内公众提供生成式 AI 服务即适用《生成式人工智能服务管理暂行办法》：第四条不得生成淫秽色情内容，第十七条具有舆论属性或社会动员能力的还要安全评估与算法备案。[生成式人工智能服务管理暂行办法](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)
4. **支付与主体**。Stripe / NowPayments 等境外通道在境内不可用；境内收款要企业资质、支付通道、发票税务；数据境内存储、个人信息与未成年人保护要求全部要落地。

结论：不是「要不要花这笔钱」，而是这条路径在合规上不存在。**任何把服务器或 CDN 节点放进境内的方案都应排除。**

## 3. 方案对比

| 方案 | 做法 | 效果 | 成本 | 工期 | 风险 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **A 免费调优** | Cloudflare Cache Rules 给 `/assets/*` 上一年强缓存；开 HTTP/3、Brotli | 二次访问少 1–3 个 RTT；首访改善有限 | ¥0 | 1–2 小时 | 低 | 先做 |
| **B 香港中继** | `cn.xumengchat.top` → 香港轻量 nginx 反代 Cloudflare，静态资源港内缓存，SSE/WS 透传 | 静态命中后约 1 个 RTT（电信 30–60ms 量级）；抖动显著下降 | ¥25–60/月 | 0.5–1 天 | 中：CF 风控要放行、地区判定变 HK、支付回调别走中继 | **推荐主方案** |
| **B+ 优选 IP** | 灰云 CNAME 到第三方 Cloudflare 优选 IP 池 | 免费、可能有效 | ¥0 | 1 小时 | 中高：非官方、IP 会变、可能失效 | 可小范围实验，不做主路径 |
| **C 静态落地镜像** | 只读介绍页 / 角色精选 / 下载说明放独立域名，无登录无 API | 被墙或故障时还能触达用户 | ¥0–20/月 | 0.5 天 | 低 | 作为兜底 |
| **D 境内合规站** | 去成人内容、境内主体、备案、境内支付、内容审核 | 合规，但等于另起一个产品 | 数万元起 + 数月 | — | 高 | 不建议 |

## 4. 推荐路线

### P0：Cloudflare 侧调优（✅ 2026-11-19 已应用并验证）

> 操作记录、踩坑与回滚见 [`docs/xumeng-p0-cn-checklist.md`](xumeng-p0-cn-checklist.md)；一键脚本为 [`infra/cn-edge/cf-p0-apply.mjs`](../infra/cn-edge/cf-p0-apply.mjs)。

1. **哈希静态资源长缓存**：已部署响应头 Transform Rule `assets-immutable`（Set static `Cache-Control: public, max-age=31536000, immutable`）。Free 套餐不能用 `matches` 正则，最终表达式为：

   ```
   starts_with(http.request.uri.path, "/assets/") and (ends_with(http.request.uri.path, ".js") or ends_with(http.request.uri.path, ".css")) and not (http.request.uri.path eq "/assets/xumeng/live/rtc.js")
   ```

   验证：哈希 js/css 返回 `max-age=31536000, immutable`；图标、`live/rtc.js`、HTML 仍是 `max-age=0`，未被误伤。
2. **HTTP/3（QUIC）**：已开，`alt-svc: h3=":443"; ma=86400`；0-RTT 同时开启。
3. **Brotli**：实测已开（br 比 gzip 小约 2.5%），不需要动。
4. **Early Hints / 103**：本站同源，收益有限，暂不处理。
5. **代码方案**：`worker.ts` 里等价的 `withHashedBundleCache` 已实现并通过测试，但面板规则已生效，**不需要部署**；留作不依赖面板配置的备份。

预期：二次访问和站内跳转明显变快；**不解决**大陆到 Cloudflare 边缘的抖动。

### P1：香港中继（推荐，¥25–60/月，约半天到一天）

```
大陆用户 → cn.xumengchat.top（A 记录，灰云，不经过 CF 代理）
              → 香港轻量 nginx
                  ├─ /assets/*  本地缓存 30 天（首屏大头）
                  └─ 其余       Host: xumengchat.top → Cloudflare → Worker（唯一数据源）
```

为什么这样拆：

- 首屏大头是 177 KB JS + 36 KB CSS，静态资源在港命中后大约 1 个 RTT，比现在跨境抖动稳定得多。
- API / SSE / WebSocket 仍回源 Cloudflare，但只传小包；中继的稳定连接改善的是「抖动」和「首 token 时间」，**不能缩短模型生成时间**（模型本来就在境外）。
- 数据仍然只有一份（Cloudflare / D1 / R2），中继不落库、不存用户数据，只做缓存。这样绕开了「双写 / 数据同步」这个真正贵且危险的部分。
- 登录态天然可用：源站把 `dzmm_session` 写到 `.xumengchat.top`，子域直接共享。

### P2：兜底入口（¥0–20/月）

- 用 Cloudflare Pages 或 R2 + 自定义域（例如 `go.xumengchat.top`，或注册后的 `xumengcat.top`）放一个纯静态页：品牌介绍、角色精选、App 下载说明、主站链接。无登录、无 API、无用户数据。
- 注意：**换域名不等于换 IP**。如果被封的是 Cloudflare 的 IP / SNI，同在 Cloudflare 的备用域名会一起挂。真正的兜底要把备用域名也放到非 Cloudflare 线路（例如同一台香港中继上再加一个 server_name）。

## 5. 香港中继实现要点

1. **机器**：香港轻量应用服务器，2C2G / 30Mbps 起。线路优先级：电信 CN2 > 移动 CMI > 普通 BGP；国内三网都要实测，只有 CN2 的单线机在联通/移动上可能反而更差。
2. **DNS**：Cloudflare 里加 `cn` A 记录指向中继 IP，**代理状态关闭（灰云）**。打开橙云就又被 CF 代理，等于白做。
3. **证书**：`acme.sh` + Cloudflare API Token（Zone.DNS:Edit）走 DNS-01，不占 80 端口，自动续期。脚本见 [`infra/cn-edge/acme-issue.sh`](../infra/cn-edge/acme-issue.sh)。
4. **反代**：配置见 [`infra/cn-edge/nginx.cn-edge.conf`](../infra/cn-edge/nginx.cn-edge.conf)。关键点：
   - `proxy_set_header Host xumengchat.top`，SNI 也用 `xumengchat.top`；
   - `proxy_set_header Origin https://xumengchat.top`（不改写则写接口 403）；
   - `/assets/` 缓存 30 天 + `immutable`，用 `proxy_hide_header Cache-Control` 覆盖源的 `max-age=0`；
   - `/api/` 关缓冲（SSE 流式）、支持 WebSocket upgrade、读超时 600s；
   - 上传 `client_max_body_size 200m`、关请求缓冲。
5. **Cloudflare 放行**：中继会作为「客户端」访问 Cloudflare，可能被 Managed Rules / Bot Fight / 速率限制拦。加一条 WAF 自定义规则：`ip.src eq <中继出口 IP>` → Skip（托管规则、速率限制、浏览器完整性检查）。只放行中继 IP，不要放整段。
6. **副作用（必须知道）**：
   - `CF-Connecting-IP` 和 `request.cf.country` 变成香港出口 → `/api/dzmm/region` 会返回 HK，前端默认语言/地区提示可能变繁中或香港；按 IP 限流的接口会把所有大陆用户算成同一个 IP。验收时要专门看语言默认值、登录、聊天、创作。
   - **支付回调不要经过中继**：Stripe / NowPayments / guagua / zpay 的回源地址保持 `https://xumengchat.top/api/...`。中继只服务浏览 / 聊天 / 创作，支付入口可引导回主域。
   - 第三方 OAuth 回调注册的是主域，登录后可能跳回 `xumengchat.top`（父域会话不会掉，但会离开加速入口）。
   - **SEO**：中继加 `X-Robots-Tag: noindex, nofollow`，canonical 仍指向主域，避免重复内容。
   - **前端有把主域写死的地方**：`worker.ts` 的 `CANONICAL_ORIGIN`、`character-share.ts` 的主域白名单、构建产物里的分享链接校验都以 `https://xumengchat.top` 为准。中继保留 Host 后大部分功能正常，但「分享链接解析 / 团本邀请链接」这类功能在 cn 子域可能校验不通过，验收时要抽查。
   - **子站**：`create.xumengchat.top`、`video.xumengchat.top` 是另外的自定义域。要一起加速就在同一台中继加 `server_name`；但 `video.` 是视频站，香港轻量 30Mbps 的月流量很容易打满，先算清带宽成本再决定，不要默认全站中继。
7. **验收清单（全过再切量）**：
   - 大陆网络打开 cn 子域：首屏、刷新、站内跳转；
   - 登录 / 退出 / 注册 / 找回密码，`dzmm_session` 落在 `.xumengchat.top`；
   - 聊天 SSE 首 token 延迟、断流重连；女友聊天（WebSocket + 容器）可用；
   - 图片/视频上传、R2 媒体加载；
   - 角色分享链接、团本邀请链接能正常生成与打开；
   - 主站与 cn 子域来回切换不掉登录；
   - 支付按钮可用，收银台跳主域；
   - 连续 100 次请求错误率 < 1%，p90 TTFB 相对主站有明确改善。

## 6. 如果「镜像域名」指的是 xumengcat.top

该域名当前未注册（2026-11-19 查询）。两种做法：

- **品牌保护 / 跳转**：注册后在 Cloudflare 加 301 到 `xumengchat.top`。成本约 $5/年，还能挡掉 typo 抢注和钓鱼。
- **独立入口**：给 Worker 加自定义域（`wrangler.jsonc` 的 `routes` 增加 `{ "pattern": "xumengcat.top", "custom_domain": true }`），或在同一台香港中继上加一个 `server_name` 并用 `proxy_cookie_domain xumengchat.top xumengcat.top` 改写 Cookie。
  注意：**Cookie 不能跨注册域共享**，`xumengcat.top` 上是独立登录态，用户要重新登录；绝对跳转也要 `proxy_redirect` 改写。
- 不建议用近似域名做「镜像」却不做品牌声明：容易被当成钓鱼站，也会分流 SEO。

## 7. 测量与验收方法

- 大陆多省：17CE / 站长工具 / boce 选电信、联通、移动各 3–5 个城市，测首页 TTFB 与完全加载；或用一台大陆云主机跑 [`infra/cn-edge/probe.sh`](../infra/cn-edge/probe.sh)。
- 关键指标：p50 / p90 TTFB、TLS 握手时间、错误率、SSE 首 token、二次访问静态资源命中率。
- 建议目标：大陆 p90 TTFB ≤ 400ms，静态资源二次访问 ≤ 100ms，错误率 < 1%。

## 8. 风险与边界

- 中继是**境外服务器**，不需要备案；但它的定性仍然是「给大陆用户加速访问境外站点」，不要在对外文案里包装成「境内合规站」。
- 中继不落用户数据；日志只留最小排障字段（IP 可截断、短保留），避免多一个数据合规面。
- 中继是单点：机器挂了只有 cn 子域不可用，主站不受影响，保持低耦合、随时可摘。
- Cloudflare 免费版不提供按国家/地区分线路解析（Geo Steering 属于 Load Balancing 付费能力）。要做「同一域名分线路」就得换权威 DNS，而那会失去 CF 代理，不划算。子域中继是最低成本的等效方案。
- 若主域在大陆被整体阻断，同域名下的 `cn` 子域也会一起不可用 → 必须另有独立域名 + 非 Cloudflare 线路（P2）。

## 9. 需要你定的三件事

1. **域名口径**：`xumengcat.top` 是笔误，还是打算注册？（决定 P2 怎么做）
2. **预算**：能不能接受 ¥25–60/月香港轻量 + 半天工期？
3. **怎么做**：我可以先只做 P0（Cloudflare 面板配置，你点几下就行）；也可以把中继部署脚本写全，你给一台香港机的 SSH，我按第 5 节配好并跑验收。

## 10. P1 部署记录（2026-11-19）

已上线一台腾讯云香港轻量（`xumeng-cn`，124.156.168.5，2C2G / 20Mbps 峰值 / 512GB 月流量），中继地址 **https://cn.xumengchat.top**。

| 项目 | 状态 |
| --- | --- |
| DNS | Cloudflare A 记录 `cn` → 124.156.168.5（灰云） |
| 证书 | Let's Encrypt，acme.sh HTTP-01（webroot），有效期至 2027-02-17，cron 自动续期 |
| nginx | 1.28.3，反代 + `/assets/` 边缘缓存 30 天，SSE/WebSocket 透传 |
| 443 | 腾讯云 Lighthouse 防火墙已放通 TCP 443 |
| Cloudflare | WAF 自定义规则 `relay-cn-allow`：`ip.src eq 124.156.168.5` → Skip |
| 回源 | 强制 IPv4（resolver `ipv6=off` + 变量 proxy_pass），否则会因无 IPv6 路由返回 421/403 |
| 服务器调优 | BBR + fq |

**实测（本机深圳电信直连，2026-11-19 18:40）**

| 指标 | cn 中继 | 主站直连 |
| --- | --- | --- |
| TLS p50 / p90 | 0.43s / 2.32s | 0.48s / 1.49s |
| TTFB p50 / p90 | 0.90s / 2.81s | 1.07s / 2.01s |
| 首页总耗时 p50 / p90 | 0.94s / 3.00s | 1.30s / 2.26s |
| 浏览器二次加载 | 331ms / 5KB 传输（静态资源全部缓存） | — |

结论：**回访明显受益于静态缓存**；首访耗时仍受"客户端→香港→Cloudflare"两段链路抖动影响，p90 暂时不如直连。下一步可考虑：静态资源预热、HTML 短缓存、多省份探测后再决定是否继续投入。
