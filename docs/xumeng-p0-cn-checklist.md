# 叙梦 P0 国内访问调优清单（Cloudflare 面板 / 脚本）

日期：2026-11-19（Asia/Shanghai）
**状态：已于 2026-11-19 通过面板应用并外部验证通过**（HTTP/3 + 0-RTT + 哈希资源一年强缓存）。下面保留操作步骤、踩坑记录和回滚方式，供以后复用。
前置：能登录 Cloudflare 面板，对 `xumengchat.top` 有编辑权限。

## 0. 三种做法（选一个）

| 做法 | 需要什么 | 时间 | 说明 |
| --- | --- | --- | --- |
| **A. 脚本一键应用（推荐）** | 一个 Cloudflare API Token | 2 分钟 | 自动改 HTTP/3、0-RTT、响应头规则，并自己验证；见 0.1 |
| **B. 面板手点** | 面板登录 | 约 20 分钟 | 照第 1–2 节点 |
| **C. 部署代码** | `wrangler login` | 约 5 分钟 | `worker.ts` 已改好并通过测试（附录 A），不需要任何面板配置 |

### 0.1 脚本一键应用

```bash
# 1) 建 token：Cloudflare → My Profile → API Tokens → Create Custom Token
#    权限：Zone → Zone → Read、Zone → Zone Settings → Edit、Zone → Config Settings → Edit
#    Zone Resources 只选 Include → xumengchat.top
#    （Config Settings 是 Transform Rules 的 API 权限，官方文档写作 Config Settings Write）
# 2) 先演练（不写线上）
CLOUDFLARE_API_TOKEN=xxx node infra/cn-edge/cf-p0-apply.mjs
# 3) 确认无误后应用，脚本会自己做外部验证
CLOUDFLARE_API_TOKEN=xxx node infra/cn-edge/cf-p0-apply.mjs --apply
```

脚本只碰三样：`http3=on`、`0rtt=on`、一条 description 为 `assets-immutable` 的响应头规则；会保留其它已有规则；不清缓存、不动 Worker。回滚 = 删掉这条规则 + 把两个开关关掉。

## 0.2 现状基线（2026-11-19 实测）

| 项目 | 应用前 | 应用后（已验证） |
| --- | --- | --- |
| 哈希静态资源 | `Cache-Control: public, max-age=0, must-revalidate`，`cf-cache-status: HIT` | **`public, max-age=31536000, immutable`** |
| 非哈希资源（图标、`live/rtc.js`） | `max-age=0` | 保持 `max-age=0, must-revalidate`（未误伤） |
| HTML 首页 | `max-age=0` | 保持 `max-age=0`（发版即时生效） |
| HTTP/3 | 无 `alt-svc` 头 | **`alt-svc: h3=":443"; ma=86400`** |
| Brotli | 已开（br 172.9 KB / gzip 177.3 KB） | 未改动 |

## 1. HTTP/3 + 0-RTT（已应用）

面板：Speed → Settings → Protocol Optimization → **HTTP/3** 开、**0-RTT Connection Resumption** 开。

验证：`curl -sI https://xumengchat.top/ | grep -i alt-svc` → `alt-svc: h3=":443"; ma=86400`。

## 2. 哈希静态资源强缓存（已应用）

面板路径：Rules → **Create rule**（新面板里没有单独的 Transform Rules 子菜单）→ 菜单里选 **Response Header Transform Rule**。

已部署的规则（`assets-immutable`，Active）：

- 规则名：`assets-immutable`
- 匹配：**Custom filter expression**，点 **Edit expression** 后填：

```
starts_with(http.request.uri.path, "/assets/") and (ends_with(http.request.uri.path, ".js") or ends_with(http.request.uri.path, ".css")) and not (http.request.uri.path eq "/assets/xumeng/live/rtc.js")
```

- 操作：**Set static** → Header name `Cache-Control` → Value `public, max-age=31536000, immutable`

### 踩过的三个坑（Free 套餐）

1. **`matches`（正则）需要 Business 套餐**：Free 会报 `not entitled: the use of operator Matches is not allowed`，所以没法用哈希正则。
2. **`starts_with` / `ends_with` 是函数，不是运算符**：要写 `starts_with(http.request.uri.path, "/assets/")`；写成 `http.request.uri.path starts_with "/assets/"` 会 `Invalid expression`。
3. **`wildcard` 里的 `?` 不生效**：`/assets/*-????????.js` 能通过校验，但匹配不到任何请求（实测响应头没变）。

没有正则可用，最终写法是「`/assets/` 下的 `.js`/`.css`，排除 `live/rtc.js`」。现有产物里 `/assets` 顶层 68 个 js/css 全部带哈希，`live/rtc.js` 是唯一非哈希脚本，所以实际等价；**以后新增非哈希 js/css 时要加进排除列表，或者直接改名带哈希**。

### 验证结果（外部 curl，2026-11-19）

```
/assets/main-JKKu7bh9.js                  → cache-control: public, max-age=31536000, immutable
/assets/main-C0erguPA.css                 → cache-control: public, max-age=31536000, immutable
/assets/xumeng/brand/xumeng-icon-192.png  → cache-control: public, max-age=0, must-revalidate
/assets/xumeng/live/rtc.js                → cache-control: public, max-age=0, must-revalidate
/（HTML）                                  → cache-control: public, max-age=0, must-revalidate
```

调试时临时加过 `X-P0-Test` 响应头做验证，已确认线上所有响应都不再有该头。

面板证据截图：`output/xumeng/p0-verification-20261119/`（`rules-overview.jpg` 规则 Active、`speed-http3.jpg` HTTP/3 与 0-RTT 已开）。

## 3. 可选：封面/海报图 1 天缓存（收益中等，有陈旧风险）

角色封面、画廊、用户卡是首屏里最占带宽的部分。它们文件名按角色 id 命名，不带哈希，改了封面要等缓存过期。

- 面板：**Rules** → **Transform Rules** → **Modify Response Header** → 再建一条
- 表达式（URI Path，matches regex）：

```
^/assets/xumeng/(covers|gallery|user-cards|exported-cards)/.*\.(webp|jpg|jpeg|png)$
```

- `Cache-Control`：`public, max-age=86400`

风险与边界：

- 换封面后，**老访客最多 1 天看到旧图**；Cloudflare 的 purge 清不掉浏览器缓存，只能靠改文件名。
- 如果封面更新很频繁，就别做这一步，或者把 `86400` 改成 `3600`。
- `live/`、`action-templates/`、`h3-actions/` 里有视频和实时脚本，不要一起缓存。

## 4. 已发现但不在 P0 处理：GTM 在大陆是必然失败的请求

`index.html` 头部有 Googletagmanager（GTM-NQ9VPKD3）的异步脚本，`www.googletagmanager.com` 在大陆被阻断。

实际影响有限：脚本是 `async`，不阻塞首屏渲染；但它会白占一个连接，并把 `load` 事件拖到超时，而且大陆用户的访问数据本来就收不到。

三个处理方式（按推荐顺序）：

1. **P1 中继层顺手做**：`cn.xumengchat.top` 的 nginx 用 `sub_filter` 把 GTM 两段（head 脚本 + noscript iframe）去掉，只影响加速入口，不动主站、不用重新部署。
2. **小改代码**：把 GTM 注入从 head 挪到 `window.addEventListener('load', ...)` 之后，或 3 秒后再注入（`src/gtm.ts` / `index.html`）。
3. 保持现状：影响可控，但每次大陆访问都会多一个失败请求。

## 5. 回滚

- 三条 Transform Rule：面板里删除即可，立即生效，无数据影响。
- HTTP/3：关掉即可，浏览器会回退到 h2。
- 不需要回滚缓存：本次没有清任何缓存。

## 6. 验收（装完做一次）

```bash
# 在大陆网络跑，比较优化前后
infra/cn-edge/probe.sh https://xumengchat.top 30
```

重点看：HTML TTFB p90、JS TTFB p90、错误数；再用浏览器看第二次访问的 Network，确认 JS/CSS 走磁盘缓存。

## 附录 A：代码方案（已实现，暂不部署；面板规则已生效）

哈希资源走的是 Worker 末尾的 `return await env.ASSETS.fetch(request)`，不经过 `publicAsset()`。仓库里已经加了：

- `src/worker.ts`：`withHashedBundleCache(response, pathname)`，只在 `^/assets/[^/]+-[A-Za-z0-9_-]{8}\.(js|css)$` 时把 `Cache-Control` 覆盖成 `public, max-age=31536000, immutable`（200 和 304 都覆盖），其余路径原样返回。
- `test/routes.test.mts`：新增用例「hashed js/css are cached for a year while other assets keep their own cache policy」。

验证结果：`tsx --test test/routes.test.mts` **17/17 通过**，`npm run build` 通过（产物哈希不变）。

面板规则已经生效，所以**现在不需要部署**。如果以后想把这层逻辑收进代码（不依赖面板配置），再执行：

```bash
cd cloudflare/dzmm-web && npm run deploy
```

两者值一致，不冲突。

两个注意点：

- 仓库的 `npm run check:worker` 本来就有 **37 个与本改动无关的类型错误**（都在 `src/live-gateway.ts`、`test/*`、`../../src/lib/*` 等文件），改动前后数量一致；部署流程走的是 `check:client` + `vite build`，不经过它。
- `_headers` 文件方式在这里**不能用**：`wrangler.jsonc` 配了 `run_worker_first: true`，Cloudflare 官方文档明确提示 `_headers` 不会作用到 Worker 生成的响应上。

## 附录 B：为什么不用 Page Rules / 全局 Browser Cache TTL

- Page Rules 是旧机制，且全局抬高 Browser Cache TTL 会把 HTML、`manifest.webmanifest`、`favicon.ico` 一起缓存，发版后用户可能长时间拿旧 HTML 引用已删除的旧 bundle。
- 这条规则的价值就在于**只碰哈希资源**，其余保持现状。
