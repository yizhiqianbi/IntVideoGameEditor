# 账号数据备份

生产库在 Cloudflare D1（`dzmm-db`）。角色卡/会话/消息都可以随时导出，**读操作，不会写库**。

## 手动导出某个账号

```bash
HOME=./.wrangler-home CLOUDFLARE_ACCOUNT_ID=<account> \
  node scripts/backup-dzmm-user.mjs --email super@xumengchat.top
# 或 --account-id <uuid>
```

输出：`output/xumeng/backups/<昵称>-<UTC时间>/`

- `characters.json`：角色卡（含 `context_json` 世界书）
- `conversations.json` / `messages.json`：会话与消息
- `favorites.json` / `preferences.json` / `character_payloads.json`
- `account.json`：账号基本信息
- `backup.zip`：以上文件打包

该目录已加入 `.gitignore`，不会误提交。

## 建议

- 大改动（迁移/批量脚本）前先跑一次备份；
- 需要每日自动备份时，把上面的命令放进 cron/launchd，例如每天 04:00；
- 恢复需要人工执行（我可以按备份写恢复脚本），备份只读导出，避免误覆盖线上。


## 每日自动备份

- `scripts/backup-daily.sh`：执行一次导出 + 保留最近 N 份（默认 14），日志写 `output/xumeng/backups/backup.log`
- macOS launchd：`bash scripts/install-backup-launchd.sh`（装到 `~/Library/LaunchAgents`，每天 04:00）
- 或 cron：`0 4 * * * /bin/bash <repo>/scripts/backup-daily.sh >> <repo>/output/xumeng/backups/cron.log 2>&1`

> 当前 DSH 沙箱不能写 `~/Library/LaunchAgents` 或 `crontab`，需要你在自己的终端执行一次安装命令。
