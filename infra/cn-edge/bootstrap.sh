#!/usr/bin/env bash
# 叙梦国内加速中继 · 一键部署（Ubuntu 22.04 / 24.04，Debian 12）
#
# 在全新的香港轻量服务器上，用 root 运行：
#   sudo DOMAIN=cn.xumengchat.top \
#        CF_Token=<Cloudflare API Token> \
#        EMAIL=you@example.com \
#        bash bootstrap.sh
#
# Token 权限：Zone → DNS → Edit，资源只选 xumengchat.top（只用它签证书）。
# 脚本做的事：装 nginx / acme.sh → DNS-01 签证书 → 写反代配置 → 开防火墙 → 自检。
# 可重复执行：证书已存在时不会重复签发（避开 Let's Encrypt 频率限制）。

set -euo pipefail

DOMAIN="${DOMAIN:-cn.xumengchat.top}"
ORIGIN="${ORIGIN:-xumengchat.top}"
EMAIL="${EMAIL:?请设置 EMAIL=你的邮箱（证书到期通知用）}"
CF_Token="${CF_Token:?请设置 CF_Token=Cloudflare API Token（Zone.DNS:Edit）}"
CERT_DIR="/etc/nginx/ssl/$DOMAIN"
CONF="/etc/nginx/conf.d/cn-edge.conf"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '✘ %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "请用 root 或 sudo 运行"
command -v apt-get >/dev/null || die "这个脚本只支持 Debian/Ubuntu"
[ -f "$(dirname "$0")/nginx.cn-edge.conf" ] || die "缺少 nginx.cn-edge.conf，请把整个 infra/cn-edge 目录传上来再运行"

say "1/6 安装依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx curl ca-certificates openssl >/dev/null
say "  nginx $(nginx -v 2>&1 | sed -E 's#.*nginx/([0-9.]+).*#\1#') 已就绪"

say "2/6 准备 acme.sh"
if [ ! -x "$HOME/.acme.sh/acme.sh" ]; then
  curl -fsS https://get.acme.sh | sh -s email="$EMAIL" >/dev/null
fi
ACME="$HOME/.acme.sh/acme.sh"
[ -x "$ACME" ] || die "acme.sh 安装失败"

say "3/6 签发证书（DNS-01，要求 $DOMAIN 的 DNS 已经在 Cloudflare）"
mkdir -p "$CERT_DIR" /var/cache/nginx/cn-edge
if [ -s "$CERT_DIR/fullchain.pem" ] && [ -s "$CERT_DIR/privkey.pem" ]; then
  say "  证书已存在，跳过签发（重新签发请先删掉 $CERT_DIR）"
else
  export CF_Token
  "$ACME" --issue --dns dns_cf -d "$DOMAIN" --keylength ec-256 >/dev/null \
    || die "证书签发失败：确认 Cloudflare token 有该 zone 的 DNS Edit 权限，且域名拼写正确"
  "$ACME" --install-cert -d "$DOMAIN" --ecc \
    --fullchain-file "$CERT_DIR/fullchain.pem" \
    --key-file "$CERT_DIR/privkey.pem" \
    --reloadcmd "systemctl reload nginx" >/dev/null
  say "  证书已安装到 $CERT_DIR"
fi

say "4/6 写入 nginx 配置（自动兼容旧版 nginx 的 http2 写法）"
sed "s/cn\.xumengchat\.top/$DOMAIN/g" "$(dirname "$0")/nginx.cn-edge.conf" > "$CONF"
NGINX_VER="$(nginx -v 2>&1 | sed -E 's#.*nginx/([0-9.]+).*#\1#')"
if dpkg --compare-versions "$NGINX_VER" lt "1.25.1"; then
  # 1.25.1 之前没有 `http2 on;` 指令，要写回 listen 参数
  sed -i '/^[[:space:]]*http2[[:space:]]*on;/d' "$CONF"
  sed -i 's/^\([[:space:]]*listen[[:space:]]*443 ssl\);/\1 http2;/' "$CONF"
  sed -i 's/^\([[:space:]]*listen[[:space:]]*\[::\]:443 ssl\);/\1 http2;/' "$CONF"
  say "  nginx $NGINX_VER：已改写为 listen ... http2"
else
  say "  nginx $NGINX_VER：使用 http2 on; 指令"
fi
if ! nginx -t >/tmp/nginx-t.log 2>&1; then
  cat /tmp/nginx-t.log
  rm -f "$CONF"
  die "nginx 配置校验失败，已回滚配置文件（见上面的报错）"
fi
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx || systemctl restart nginx
say "  nginx 已加载配置"

say "5/6 防火墙"
if command -v ufw >/dev/null; then
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  say "  ufw 已放行 22/80/443"
else
  say "  没有 ufw，请确认云厂商安全组只开 22/80/443"
fi

say "6/6 自检"
IP="$(curl -fsS -m 10 https://api.ipify.org 2>/dev/null || echo "未知")"
echo "  本机公网 IP：$IP"
echo "  DNS 记录：A  cn → $IP（Cloudflare 里必须关闭代理/灰云）"
echo "  证书到期：$(openssl x509 -enddate -noout -in "$CERT_DIR/fullchain.pem" 2>/dev/null | cut -d= -f2 || echo 未知)"
if [ "$IP" != "未知" ]; then
  CODE="$(curl -sk -o /dev/null -m 10 -w '%{http_code}' --resolve "$DOMAIN:443:$IP" "https://$DOMAIN/" || true)"
  echo "  本机回环测试 $DOMAIN → HTTP $CODE（404/403 也算通，说明 nginx 和证书正常）"
fi

cat <<EOF

────────────────────────────────────────────
还剩两步（在 Cloudflare 面板做）：

1) DNS：A 记录  cn  →  $IP     代理状态：DNS only（灰云）
2) WAF 放行：Security → WAF → Custom rules
   表达式：ip.src eq $IP
   动作：Skip（勾选托管规则、速率限制、浏览器完整性检查）

然后在大陆网络跑：
  infra/cn-edge/probe.sh https://$DOMAIN 30 https://$ORIGIN

验收清单（登录、SSE、WebSocket、上传、语言默认值）见 infra/cn-edge/README.md。
────────────────────────────────────────────
EOF
