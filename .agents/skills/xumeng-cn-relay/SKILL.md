---
name: xumeng-cn-relay
description: >-
  Build, verify, and troubleshoot a mainland-China acceleration relay for a site hosted
  outside mainland China (Cloudflare Workers/Pages, overseas VPS) without moving data,
  copying the database, or filing an ICP license: a Hong Kong lightweight VPS running nginx
  as a reverse proxy with edge caching, Let's Encrypt via HTTP-01, a grey-cloud Cloudflare
  DNS subdomain, and a WAF allow rule for the relay IP. Use when asked for 国内镜像 /
  国内加速入口 / cn 子域 / 香港中继 / 回源 421 403 / 静态资源 403 / 证书签发失败, or when a
  China-facing mirror must not be hosted in mainland (备案 / 成人内容 / 生成式 AI 合规).
  Covers the five recurring pitfalls: IPv6 origin resolution, Lighthouse firewall 443,
  Cloudflare WAF blocking the relay IP, webroot ACME writes, and local TUN proxies breaking
  SSH. Not for domestic hosting, ICP filing, or data synchronization — those are separate
  and usually blocked for adult/AI companion content.
---

# 叙梦国内加速中继（香港 nginx 反代）

目标：让大陆用户通过 `cn.<主域>` 更快、更稳地访问境外主站，**数据只有一份**，中继只做缓存与透传。

## 何时用 / 何时不用

用：

- 主站在 Cloudflare（Workers / Pages / 反代）或其他境外主机，大陆访问慢、抖动大
- 想给大陆用户一个加速入口，但**不迁移数据、不做双写**
- 需要 tls 正常、静态资源走浏览器缓存

不用 / 先否掉：

- **境内服务器或境内 CDN 节点**：必须 ICP 备案；成人内容、生成式 AI 陪伴类过不了内容审核；支付主体也不在境内。结论是"合规上不存在这条路"，不要浪费时间报价
- 需要"主域被封时仍可用"：同域子域会一起被封，得另买独立域名 + 非 Cloudflare 线路（另案）
- 视频站等大流量子站：香港轻量 20–30Mbps 带宽/月流量包很快打满，不要默认全站中继

## 架构

```
大陆用户 → cn.<主域>（Cloudflare A 记录，灰云 / DNS only）
              → 香港轻量 nginx
                  ├─ /assets/*  本地缓存 30 天（首屏大头）
                  └─ 其余       Host: <主域> → Cloudflare → Worker（唯一数据源）
```

关键前提（先在代码里确认，不要猜）：

- 登录态 Cookie 是否提升到父域 `.主域`：是 → 子域中继可直接共享登录；否 → 需要单独登录或改写 Cookie
- 写接口是否校验 `Origin === 自身 origin`：是 → 中继必须把 `Origin` 改写成 `https://<主域>`，否则登录后的写操作 403
- 是否依赖 `CF-Connecting-IP` / `request.cf.country`：是 → 中继后这些值变成香港出口，地区判定、按 IP 限流会受影响

## 步骤

1. **买机**：腾讯云/阿里云轻量，地域**中国香港**，Ubuntu 24.04，2C2G / 30Mbps 起；需要云账号实名，香港机本身不需要备案。安全组放 22/80/443。
2. **传脚本并部署**：

   ```bash
   scp -r infra/cn-edge root@<IP>:/root/
   ssh root@<IP>
   cd /root/cn-edge
   DOMAIN=cn.<主域> CF_Token=<token> EMAIL=<邮箱> bash bootstrap.sh
   ```

   `CF_Token` 只要 `Zone → DNS → Edit`（仅用于 DNS-01 签证书；若 DNS 已指向服务器，也可改用 webroot HTTP-01，不需要 token）。
3. **Cloudflare DNS**：加 `A` 记录 `cn` → 服务器 IP，**代理状态关闭（灰云）**。橙云会又走 CF，等于白做。
4. **Cloudflare WAF 放行中继 IP**：Security → Security rules → Custom rules → `ip.src eq <中继IP>` → Skip（勾选 Managed rules、Rate limiting、Super Bot Fight Mode）。不加的话静态资源会被风控 403/421。
5. **腾讯云 Lighthouse 防火墙**：实例详情 → 防火墙 → 加 `TCP 443 允许 0.0.0.0/0`（默认常只放通 22/80；注意是实例防火墙，不是左侧"防火墙模板"）。
6. **签发证书**（DNS 已指向时）：

   ```bash
   curl -fsS https://get.acme.sh | sh -s email=<邮箱>
   ~/.acme.sh/acme.sh --set-default-ca --server letsencrypt
   sudo mkdir -p /var/www/acme && sudo chown -R $USER:$USER /var/www/acme
   ~/.acme.sh/acme.sh --issue --webroot /var/www/acme -d cn.<主域> --keylength ec-256
   sudo env HOME="$HOME" ~/.acme.sh/acme.sh --install-cert -d cn.<主域> --ecc \
     --fullchain-file /etc/nginx/ssl/cn.<主域>/fullchain.pem \
     --key-file /etc/nginx/ssl/cn.<主域>/privkey.pem \
     --reloadcmd "systemctl reload nginx"
   ```
7. **开 BBR**（跨境链路抗抖动）：

   ```bash
   echo -e "net.core.default_qdisc=fq\nnet.ipv4.tcp_congestion_control=bbr" | sudo tee /etc/sysctl.d/99-bbr.conf
   sudo sysctl -p /etc/sysctl.d/99-bbr.conf
   ```

## 关键配置（最容易错的一段）

回源**必须强制 IPv4**：多数香港轻量没有 IPv6 路由，而 Cloudflare 的 AAAA 会先被解析到；nginx 连 IPv6 失败后表现为 **421 / 403 / 502 混合错误**，日志里是 `connect() to [2606:...]:443 failed (101: Network is unreachable)`。

```nginx
resolver 1.1.1.1 223.5.5.5 valid=300s ipv6=off;   # 不要用 upstream 块

server {
    listen 443 ssl;
    http2 on;
    server_name cn.<主域>;
    set $origin https://<主域>;

    proxy_http_version 1.1;
    proxy_set_header Host              <主域>;
    proxy_set_header Origin            https://<主域>;   # 写接口 origin 校验
    proxy_set_header X-Forwarded-Proto https;
    proxy_ssl_server_name on;
    proxy_ssl_name        <主域>;

    location ^~ /assets/ {
        proxy_pass $origin$request_uri;
        proxy_cache cn_edge;
        proxy_cache_valid 200 30d;
        proxy_ignore_headers Set-Cookie Cache-Control Expires;
        proxy_hide_header Cache-Control;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header X-Cache-Status $upstream_cache_status always;
        add_header X-Robots-Tag "noindex, nofollow" always;
    }

    location ^~ /api/ {
        proxy_pass $origin$request_uri;
        proxy_buffering off;          # SSE 流式
        proxy_request_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
    }

    location / {
        proxy_pass $origin$request_uri;
        add_header X-Robots-Tag "noindex, nofollow" always;
    }
}
```

完整模板见 `references/nginx-relay.conf`（含 80 端口 301 + ACME webroot 路径）。

## 五个坑（按症状查）

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| 页面 HTML 200，但 `/assets/*` 421/403、控制台报错 | nginx 回源走了 IPv6，服务器无 IPv6 路由 | `resolver ... ipv6=off` + 变量 `proxy_pass $origin$request_uri;`，三处 location 都要改，然后 **restart** 不是 reload |
| 中继回源 403 Forbidden（Cloudflare 页面），静态资源全挂 | Cloudflare WAF/Bot 拦机房 IP | WAF 自定义规则 `ip.src eq <中继IP>` → Skip（Managed rules / Rate limiting / SBFM）；必要时关 Browser Integrity Check 只对该 IP 用 Configuration Rule |
| 浏览器 `ERR_CONNECTION_CLOSED`、外网节点测 443 超时 | 腾讯云 Lighthouse 防火墙只放通 22/80 | 实例详情 → 防火墙 → 加 TCP 443（不是"防火墙模板"） |
| `acme.sh` 报 `Cannot write token to file` | `/var/www/acme` 属主是 root，acme.sh 用普通用户跑 | `sudo chown -R $USER:$USER /var/www/acme` |
| 本机 SSH 连不上香港机（kex 前被关闭），但换网络就好 | 本机 Clash/TUN 代理接管了到该 IP 的流量 | 关 TUN / 把目标 IP 加直连规则；**不要**擅自借别人的机器做跳板 |

## 验收

```bash
R="--resolve cn.<主域>:443:<IP>"

curl -sI $R https://cn.<主域>/ | head -5                       # 200，cf-cache-status HIT
curl -sI $R https://cn.<主域>/assets/main-*.js | grep -i cache # immutable + x-cache-status HIT
curl -sI $R https://cn.<主域>/assets/<非哈希图>.png            # 必须仍是 max-age=0（不能误伤）
echo | openssl s_client -connect <IP>:443 -servername cn.<主域> 2>/dev/null \
  | grep -E 'issuer=|Verify return'                            # Let's Encrypt + code 0
curl -s $R https://cn.<主域>/api/backend/v1/session            # 正常 JSON，不是 CF 错误页
curl -s $R -D - -o /dev/null -X POST https://cn.<主域>/api/backend/v1/auth/guest \
  | grep -i set-cookie                                         # Domain=.<主域> → 会话共享
```

再用真实浏览器（Playwright 或手机流量）打开一次，确认没有 4xx 资源、二次加载命中缓存。

## 回滚（随时可摘）

- 删除 Cloudflare `cn` A 记录 → 入口立即失效，主站完全不受影响
- 服务器：`rm /etc/nginx/conf.d/cn-edge.conf && systemctl restart nginx`
- WAF 规则 / Lighthouse 443 规则可保留，不影响主站

## 边界与注意事项

- 中继是**境外服务器**：不需要备案，但也不要对外宣称"境内合规站"
- 支付回调、第三方 OAuth 回调**不要走中继**，回源地址保持主域
- 中继不落用户数据；日志只留排障最小字段
- SEO：中继返回 `X-Robots-Tag: noindex`，canonical 仍指主域
- 首访耗时仍受"客户端→香港→Cloudflare"两段链路影响；中继主要收益是**静态缓存**和**回访**，不要承诺首访更快
- 本仓库落地记录见 `docs/xumeng-cn-access-plan.md` 第 10 节，脚本与配置在 `infra/cn-edge/`
