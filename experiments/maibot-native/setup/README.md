# 原生 MaiBot 本地实例

这套脚本只准备官方 Runtime 的运行配置，不包含自写 Planner、Replyer、记忆替代层，也不修改上游源码。

当前上游源码位于 `../upstream`，提交记录见 `snapshot.json`。依赖按官方 `uv.lock` 安装，实例文件在 `../instance`；模型配置和 WebUI 认证文件只存于该忽略目录，权限为 `0600`。

## 准备

从工作区根目录执行：

```sh
cd experiments/maibot-native/upstream
/Users/pencil/.local/bin/uv sync --frozen --no-dev
cd ../../..
experiments/maibot-native/upstream/.venv/bin/python experiments/maibot-native/setup/configure.py
```

脚本先调用官方 `maibot init`，再用官方配置类校验配置。可重复执行，已有消息、数据库、记忆和 WebUI 认证不会清空。它从工作区 `.env.local` 读取已有 OpenRouter 服务配置，再应用 `experiments/character-chat/.env.local` 的模型设置；不会输出密钥。文本任务使用 DeepSeek V4.1 Flash，记忆向量使用 `qwen/qwen3-embedding-8b`，维度为 4096。

## 启动

```sh
experiments/maibot-native/upstream/.venv/bin/maibot run --directory experiments/maibot-native/instance
```

这是官方 CLI，随后启动原生 Runner 和 Worker。首次运行需要用户阅读上游 `EULA.md` 与 `PRIVACY.md` 并在终端确认；本脚本不会代填或绕过确认。协议文档更新后官方 Runtime 会重新要求确认。

监听地址全部为 `127.0.0.1`：

| 服务 | 端口 |
| --- | --- |
| 原生 WebUI / 官方聊天 WebSocket | 18001 |
| 原生旧版消息 WebSocket | 8095 |
| 原生新版消息 API | 8096 |

WebUI 固定认证令牌保存在 `instance/data/webui.json`。网站网关在服务端读取并交换官方一次性 WebSocket 票据，浏览器不接触管理令牌。

## 配置范围

- 人设：Yume，22 岁成年女生，商科学生、竞技游戏爱好者；使用原生 `personality` 三个字段设定身份、行为和表达。
- 原生 `experimental.planner_message_steering` 开启，以支持连续发送时更新决策。
- 完整内置 A_Memorix 开启，使用实例独立数据目录；画像、片段、演化、写回等保持官方默认，启发式召回调整为至少 8 条新消息、60 秒间隔。
- 原生插件 Runtime 开启；不会自动安装来历不明的插件。
- 遥测与外部 MCP 关闭，不连接 QQ 等外部聊天适配器。
- 不自动下载插件渲染用 Chromium；插件需要渲染时再按官方流程准备。
- `snapshot.json` 与 `instance/runtime-info.json` 是不含凭据的配置说明，不代表服务已经健康启动。

停止时向官方 Runner 发送终止信号，等待 Worker 正常保存并关闭。不要为切换引擎删除旧聊天记录；新原生实例的数据库、会话与旧实现独立。
