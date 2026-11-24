#!/usr/bin/env bash
# 为 cn.xumengchat.top 签发 / 续期证书（Cloudflare DNS-01，不占用 80 端口）
#
# 前置：
#   - 已安装 acme.sh（curl https://get.acme.sh | sh -s email=you@example.com）
#   - 在 Cloudflare 创建 API Token：权限 Zone / DNS / Edit，范围限定 xumengchat.top
#   - 已给中继主机配置 DNS：cn.xumengchat.top A <中继 IP>（灰云 / DNS only）
#
# 用法：
#   export CF_Token="你的 token"
#   ./acme-issue.sh
#
# 首次签发后 acme.sh 会自己装 cron 自动续期，并调用下面的 reloadcmd。

set -euo pipefail

DOMAIN="${DOMAIN:-cn.xumengchat.top}"
OUT="${OUT:-/etc/nginx/ssl/$DOMAIN}"

: "${CF_Token:?请先 export CF_Token=<Cloudflare API Token>}"

command -v acme.sh >/dev/null 2>&1 || {
  echo "未找到 acme.sh，请先安装：curl https://get.acme.sh | sh -s email=you@example.com" >&2
  exit 1
}

mkdir -p "$OUT"

acme.sh --issue --dns dns_cf -d "$DOMAIN" --keylength ec-256

acme.sh --install-cert -d "$DOMAIN" --ecc \
  --fullchain-file "$OUT/fullchain.pem" \
  --key-file       "$OUT/privkey.pem" \
  --reloadcmd      "systemctl reload nginx"

echo "完成：$OUT/fullchain.pem 与 $OUT/privkey.pem"
echo "可用 acme.sh --list 查看下次续期时间；续期后会执行 systemctl reload nginx"
