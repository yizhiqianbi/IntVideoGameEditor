# 叙梦国内加速中继（香港节点）

目标：让大陆用户通过 `cn.xumengchat.top` 更快、更稳地访问叙梦主站，**不复制数据、不落境内**。
数据源唯一：`xumengchat.top`（Cloudflare Workers + D1/R2/DO/Containers）。

完整决策与风险说明见 [`docs/xumeng-cn-access-plan.md`](../../docs/xumeng-cn-access-plan.md)。

## 文件

| 文件 | 说明 |
| --- | --- |
| `nginx.cn-edge.conf` | 反代 + 静态缓存 + SSE/WS 透传配置 |
| `acme-issue.sh` | 用 Cloudflare DNS-01 签发 / 续期证书 |
| `probe.sh` | 中继 vs 主站的延迟对比探针 |
| `cf-p0-apply.mjs` | P0 一键应用：HTTP/3 + 0-RTT + 哈希资源响应头规则（默认演练） |
| `bootstrap.sh` | P1 一键部署：装 nginx / acme.sh、DNS-01 签证书、写配置、开防火墙 |

## P0：先做这个（不用买机器）

在买香港机之前先把 P0 做完，成本 ¥0：

```bash
# 需要一个 Cloudflare API Token：
#   Zone Read + Zone Settings:Edit + Config Settings:Edit，资源只选 xumengchat.top
CLOUDFLARE_API_TOKEN=xxx node cf-p0-apply.mjs          # 演练，不写线上
CLOUDFLARE_API_TOKEN=xxx node cf-p0-apply.mjs --apply  # 应用，并自己验证响应头
```

也可以照 [`docs/xumeng-p0-cn-checklist.md`](../../docs/xumeng-p0-cn-checklist.md) 在面板手点；清单附录 A 还有等价的 Worker 代码方案（已实现并通过测试，`npm run deploy` 生效）。

## 拓扑

```
大陆用户 → cn.xumengchat.top（A 记录，灰云）
              → 香港轻量 nginx
                  ├─ /assets/*  本地缓存 30 天
                  └─ 其余       Host: xumengchat.top → Cloudflare → Worker
```

## 最快路径（推荐）

```bash
# 1) 本机把目录传到新买的香港机
scp -r infra/cn-edge root@<服务器IP>:/root/

# 2) 登录后一条命令装完（Token 只要 Zone → DNS → Edit，资源选 xumengchat.top 即可）
ssh root@<服务器IP>
cd /root/cn-edge
DOMAIN=cn.xumengchat.top CF_Token=<token> EMAIL=you@example.com bash bootstrap.sh

# 3) 回 Cloudflare 面板：加 A 记录 cn（灰云）+ WAF 放行服务器 IP
# 4) 大陆网络验收
./probe.sh https://cn.xumengchat.top 30 https://xumengchat.top
```

脚本会自动兼容 Ubuntu 22.04/24.04 自带的老版 nginx（它们没有 `http2 on;` 指令），配置校验失败会回滚。下面的手工步骤保留作参考。

## 部署步骤

### 1. 买机器

- 香港地域轻量应用服务器，2C2G / 30Mbps 起；系统 Ubuntu 22.04+ 或 Debian 12+。
- 线路优先电信 CN2 / 移动 CMI；开了机先用 `probe.sh` 从大陆三网各测一次再决定是否续费。
- 安全组只放 22、80、443；SSH 改密钥登录，关密码登录。

### 2. 装依赖

```bash
sudo apt update && sudo apt install -y nginx curl
curl https://get.acme.sh | sh -s email=you@example.com
```

### 3. 配 DNS（Cloudflare）

- 类型 `A`，名称 `cn`，内容 = 中继公网 IP，**代理状态：DNS only（灰云）**。
- 如果中继有 IPv6，再补一条 `AAAA`；Cloudflare 放行时两种地址都要加。

### 4. 签证书

```bash
export CF_Token="<Cloudflare API Token：Zone.DNS:Edit，范围限 xumengchat.top>"
sudo -E bash ./acme-issue.sh
```

### 5. 上反代配置

```bash
sudo cp nginx.cn-edge.conf /etc/nginx/conf.d/cn-edge.conf
sudo nginx -t && sudo systemctl reload nginx
```

`http2 on;` 需要 nginx ≥ 1.25.1；旧版本把 `listen 443 ssl;` 改成 `listen 443 ssl http2;` 并删掉这一行。

### 6. Cloudflare 放行中继

中继访问源站时，Cloudflare 会把中继 IP 当作客户端，可能被托管规则 / Bot Fight / 速率限制拦截。

- Security → WAF → Custom rules → 新建：`ip.src eq <中继 IPv4> or ip.src eq <中继 IPv6>` → 动作 **Skip**，勾选托管规则、速率限制、浏览器完整性检查等相关组件。
- 不要放行整段 IP，只放行中继出口地址。
- 如果站点开了 Under Attack Mode，中继会拿到挑战页，需临时关闭或对该 IP 跳过。

### 7. 验收（全过再对外发链接）

```bash
# 在大陆网络执行，或在大陆云主机上执行
./probe.sh https://cn.xumengchat.top 30 https://xumengchat.top
```

手工清单：

- [ ] 首屏、刷新、站内跳转正常，静态资源 `X-Cache-Status` 为 HIT
- [ ] 登录 / 退出 / 注册 / 找回密码正常；`dzmm_session` 落在 `.xumengchat.top`
- [ ] 主站与 cn 子域来回切换不掉登录
- [ ] 聊天 SSE 有流式输出，断网重连正常
- [ ] 女友聊天（WebSocket + 容器）可用
- [ ] 图片 / 视频上传与 R2 媒体加载正常
- [ ] 角色分享链接、团本邀请链接能正常生成与打开
- [ ] 默认语言没有被误判成繁中 / 香港
- [ ] 支付按钮可用，收银台跳到主域
- [ ] 连续 100 次请求错误率 < 1%

## 部署时踩过的坑（2026-11-19 实战）

1. **回源 IPv6 不通 → 421/403/502**：服务器没有 IPv6 路由时，nginx 会先解析 Cloudflare 的 AAAA 记录，连接失败后表现为 `426/421/403` 混合错误。配置里必须用 `resolver ... ipv6=off` + 变量 `proxy_pass $origin$request_uri;`（模板已内置）。
2. **Cloudflare 风控拦中继 IP**：中继回源请求来自机房 IP，容易被 WAF/Bot 拦。需要 WAF 自定义规则 `ip.src eq <中继IP>` → Skip（Managed rules / Rate limiting / Super Bot Fight Mode），或 IP Access Rules 加 Allow。
3. **腾讯云 Lighthouse 防火墙默认只放通 22/80**：443 要在实例详情「防火墙」里手动加 `TCP 443 允许 0.0.0.0/0`，注意别加到「防火墙模板」。
4. **证书走 HTTP-01 更方便**：DNS 指向服务器后，用 `acme.sh --webroot /var/www/acme`，不需要 Cloudflare API Token；模板里已带 `/.well-known/acme-challenge/` 路径。
5. **BBR**：香港轻量默认拥塞控制可能不是 BBR，建议开（`net.core.default_qdisc=fq` + `net.ipv4.tcp_congestion_control=bbr`）。

## 已知副作用

- `CF-Connecting-IP`、`request.cf.country` 变成香港出口：`/api/dzmm/region` 返回 HK，按 IP 限流的接口会把大陆用户合并计数。
- 支付回调不要经过中继，回源地址保持 `https://xumengchat.top/api/...`。
- 第三方 OAuth 登录后可能回到主域（会话不掉，但离开加速入口）。
- 中继是单点：挂了只是 cn 子域不可用，主站不受影响；回滚就是删 DNS 记录 + 停 nginx。

## 运维

- 缓存目录 `/var/cache/nginx/cn-edge`，上限 2G，最少访问 14 天淘汰；发版后静态资源文件名带新哈希，无需手动清缓存。
- 证书续期由 acme.sh 的 cron 完成，续期后自动 `systemctl reload nginx`。
- 日志只保留排障需要的最小字段；不要把 Cookie、请求体写进日志。
- 监控建议：对 `https://cn.xumengchat.top/` 和 `/assets/main-*.js` 做 1 分钟拨测，连续 3 次失败告警。
