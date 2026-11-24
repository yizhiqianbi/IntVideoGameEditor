# REA 本机安装记录

日期：2026-10-14，Asia/Shanghai。按照 [REA 官方安装说明](https://github.com/morluto/rea/blob/main/docs/installation.md)，只配置 Codex，未安装或配置其他客户端及原生反汇编 provider。

## 已完成

- 固定安装 `rea-agents@6.4.0`，目录 `/Users/pencil/.codex/tools/rea-6.4.0`。未改当前项目 package.json / lockfile。
- 使用现有 Codex bundled Node 24.19.0。官方 npm engine 要求 `^22.19.0 || ^24.11.0 || >=26.0.0`；系统 Node 25.2.1 不匹配，未升级系统 Node。
- npm 安装使用 `--ignore-scripts --no-audit --no-fund --save-exact`。
- 执行官方 `setup --client codex --dry-run --json`，随后 `setup --client codex --yes --json`。
- 安装 [官方 REA skill](/Users/pencil/.agents/skills/reverse-engineer-anything/SKILL.md)，版本 37。
- 将 Codex REA 启动器固定到支持的 Node，避免官方 shebang 回到 Node 25。
- 建立本机 CLI 启动器 [rea](/Users/pencil/.local/bin/rea)。

## Codex 配置

配置文件：[config.toml](/Users/pencil/.codex/config.toml)。只调整 `mcp_servers.rea`，其他配置的解析结果保持相同；没有修改环境变量或审批策略。

```toml
[mcp_servers.rea]
command = "/Users/pencil/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
args = ["/Users/pencil/.codex/tools/rea-6.4.0/node_modules/rea-agents/scripts/rea.mjs", "mcp"]
startup_timeout_sec = 30
```

备份文件：

- `/Users/pencil/.codex/config.toml.rea.backup`：官方 setup 前备份。
- `/Users/pencil/.codex/config.toml.rea-node24.backup`：固定 Node 启动器前备份。

两个备份已收紧到文件模式 0600。需要撤销时应仅移除 REA 配置块、恢复相关启动器；不要覆盖后续其他配置变更。

## 验证结果

`rea --version` 返回 6.4.0。`rea doctor --client codex --json` 返回 healthy，注册与 skill 状态 aligned。另行启动真实 stdio MCP 子进程，执行 initialize / tools/list：服务器 rea 6.4.0、协议 2025-06-18、170 个工具，验证后已结束该进程。

[doctor 摘要](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/rea-setup-status.json)、[MCP 握手证据](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/rea-mcp-check.json)已保存。原有 Homebrew Codex CLI 的 `mcp get` 检查因其 Codex binary 路径 ENOENT 无法完成；本次没有修复这个无关 CLI 问题，使用 TOML 解析、REA doctor 和真实握手核验配置。

**当前聊天没有热加载新 MCP 工具，也没有重启桌面 app。**本次已使用 CLI 完成实际分析；下次重启或重新连接 Codex 后可载入 MCP 注册。独立握手证明服务器可运行，不等同于当前桌面会话已经连接。

## CLI 用法

```sh
/Users/pencil/.local/bin/rea --version
/Users/pencil/.local/bin/rea doctor --client codex --json
/Users/pencil/.local/bin/rea analyze-javascript-application "/绝对路径/公开脚本目录" --max-heap-mb 512 --analysis-timeout-ms 20000 --format json --full-output
```

本次实际分析的是下载自官网声明资源的三个输入目录：rea-input、rea-core-input、rea-role-input；分别保存原始 Evidence 和 inspect-analysis-view 的 summary。未执行目标脚本。涉及后台运行、登录态请求和真实模型的结论仍需其他证据。

npm tarball integrity（安装版本固定）：

```text
sha512-Vj1zWfSlna5bphGoaoI/TcVBuYvze9u+OyPC3Shz8YkBqaCTqB4COnnRoX7XDwMpwI24ZlFEel2yEj0k8LTWEQ==
```

整体研究见 [report.md](/Users/pencil/Documents/IntVideoGameEditor/experiments/character-chat/research/dzmm-2026-10-14/report.md)。
