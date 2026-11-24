#!/usr/bin/env bash
# 中继 / 主站延迟对比探针
#
# 建议在大陆云主机上跑（不同省份各跑一次），本机在境外跑出来的数字只能看抖动。
#
# 用法：
#   ./probe.sh https://cn.xumengchat.top
#   ./probe.sh https://cn.xumengchat.top 20 https://xumengchat.top
#
# 输出：HTML 与主 JS 的 TTFB / 总耗时的 p50、p90、max 与错误数。

set -uo pipefail

if [ $# -lt 1 ]; then
  echo "用法: $0 <base-url> [samples] [compare-base-url]" >&2
  exit 2
fi

BASE="$1"
SAMPLES="${2:-20}"
COMPARE="${3:-}"
TMPDIR_PROBE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_PROBE"' EXIT

pct() { # $1=文件(未排序), $2=百分位 0-1
  sort -n "$1" | awk -v p="$2" '
    { a[NR] = $1 }
    END {
      if (NR == 0) { printf "NA"; exit }
      i = int((NR + 1) * p); if (i < 1) i = 1; if (i > NR) i = NR
      printf "%d", a[i]
    }'
}

max_of() {
  sort -n "$1" | awk 'END { if (NR == 0) printf "NA"; else printf "%d", $1 }'
}

main_js_path() { # $1=base -> /assets/main-xxx.js 或空
  curl -sS -m 20 "$1/" 2>/dev/null \
    | grep -oE '/assets/main-[A-Za-z0-9_-]+\.js' \
    | head -1 || true
}

measure() { # $1=base $2=label
  local base="$1" label="$2"
  local html_url js_path js_url
  html_url="$base/"
  js_path="$(main_js_path "$base")"
  if [ -n "$js_path" ]; then js_url="$base$js_path"; else js_url=""; fi

  local i out tls ttfb total code
  local h_ttfb="$TMPDIR_PROBE/h_ttfb" h_tot="$TMPDIR_PROBE/h_tot"
  local j_ttfb="$TMPDIR_PROBE/j_ttfb" j_tot="$TMPDIR_PROBE/j_tot"
  : >"$h_ttfb"; : >"$h_tot"; : >"$j_ttfb"; : >"$j_tot"
  local h_fail=0 j_fail=0

  echo "目标 $label ($base)，样本 $SAMPLES 次" >&2

  for ((i = 1; i <= SAMPLES; i++)); do
    out="$(curl -sS -o /dev/null -m 30 -w '%{time_starttransfer} %{time_total} %{http_code}' "$html_url" 2>/dev/null)" || out="0 0 000"
    ttfb="${out%% *}"; rest="${out#* }"; total="${rest%% *}"; code="${rest##* }"
    [ "$code" = "200" ] || h_fail=$((h_fail + 1))
    [ "$code" = "200" ] && { printf '%s\n' "$(awk -v v="$ttfb" 'BEGIN{printf "%d", v*1000}')" >>"$h_ttfb"; printf '%s\n' "$(awk -v v="$total" 'BEGIN{printf "%d", v*1000}')" >>"$h_tot"; }

    if [ -n "$js_url" ]; then
      out="$(curl -sS -o /dev/null -m 30 -w '%{time_starttransfer} %{time_total} %{http_code}' "$js_url" 2>/dev/null)" || out="0 0 000"
      ttfb="${out%% *}"; rest="${out#* }"; total="${rest%% *}"; code="${rest##* }"
      [ "$code" = "200" ] || j_fail=$((j_fail + 1))
      [ "$code" = "200" ] && { printf '%s\n' "$(awk -v v="$ttfb" 'BEGIN{printf "%d", v*1000}')" >>"$j_ttfb"; printf '%s\n' "$(awk -v v="$total" 'BEGIN{printf "%d", v*1000}')" >>"$j_tot"; }
    fi
  done

  printf '%-14s %8s %8s %8s %8s\n' "资源" "p50" "p90" "max" "错误"
  printf '%-14s %8s %8s %8s %8s\n' "HTML TTFB" "$(pct "$h_ttfb" 0.50)" "$(pct "$h_ttfb" 0.90)" "$(max_of "$h_ttfb")" "$h_fail"
  printf '%-14s %8s %8s %8s %8s\n' "HTML 总耗时" "$(pct "$h_tot" 0.50)" "$(pct "$h_tot" 0.90)" "$(max_of "$h_tot")" "-"
  if [ -n "$js_url" ]; then
    printf '%-14s %8s %8s %8s %8s\n' "JS TTFB" "$(pct "$j_ttfb" 0.50)" "$(pct "$j_ttfb" 0.90)" "$(max_of "$j_ttfb")" "$j_fail"
    printf '%-14s %8s %8s %8s %8s\n' "JS 总耗时" "$(pct "$j_tot" 0.50)" "$(pct "$j_tot" 0.90)" "$(max_of "$j_tot")" "-"
    echo "JS 路径: $js_path"
  else
    echo "未在首页找到 /assets/main-*.js，只测了 HTML"
  fi
  echo
}

echo "单位：毫秒。建议在大陆电信 / 联通 / 移动网络各跑一次。"
echo
measure "$BASE" "目标"
if [ -n "$COMPARE" ]; then
  measure "$COMPARE" "对比"
fi
