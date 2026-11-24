# XUMENG · 原生 MaiBot 女友

本目录运行官方 MaiBot 1.3.9，固定提交 `ac6ed61b7b9c971ad94921de3b16fa6f63c36a20`。源码来自 https://github.com/Mai-with-u/MaiBot ，保留完整 LICENSE、EULA、PRIVACY 和 A_Memorix 子项目许可证。它是独立进程中的真实 Runner / Worker，不是提示词仿写或重新实现。

保留一处透明的原生兼容补丁：[patches/0001-metadata-json-scope.patch](patches/0001-metadata-json-scope.patch)。该版本的记忆范围查询把 SQLite 返回的 JSON 字符串当作空元数据，导致已存事实检索不到；补丁只在原生解析入口正确解码 JSON，不改检索算法、prompt 或隔离规则。修前真实 SQLite 用例失败，修后 48 项目标测试通过。安装器会幂等应用它，遇到冲突直接停止。

## 运行链路

`女友 React 页面 → Next 身份/归属桥接 → gateway.mjs → 官方 WebUI WebSocket → chat_bot.message_process → 原生 HeartFlow / MaiSaka Runtime → 原生 Planner、tools、Replyer → 官方发送器 → 网页`

`src/A_memorix` 完整原生宿主负责画像、事实、摘要、向量/图谱和召回。原生插件 Runtime 在独立子进程中加载官方随包插件；可按上游文档扩展。我们的网关只转换消息传输、保留发送确认和重连历史，并把主动触发透传给原生 Maisaka，不调用模型，不写 prompt，不产生/重写对白，不复制原生记忆。

前端允许连续输入；原生 `planner_message_steering` 开启。原生推送在网关 WebSocket 上持续接收，网页刷新读取消息。角色回复后如果保持安静约 45 秒，页面只请求当前用户回合的一次原生 proactive 判断；是否真的发言仍由原生 Planner 决定，网关不会插入伪造的用户消息，服务端也会跨刷新去重。

## 本机启动

- 安装：`UV_BIN=/Users/pencil/.local/bin/uv sh experiments/maibot-native/setup/install.sh`。独立虚拟环境，严格使用上游 lockfile。
- 初始化配置脚本只迁移现有 OpenRouter 设置；运行时不导入 `experiments/character-chat`。
- 启动：`node scripts/xumeng-companion-dev.mjs`。
- 入口：http://127.0.0.1:3010/xumeng#chat/girlfriend（消息页「聊天」分类中的 Yume；旧 `/xumeng/girlfriend` 地址会自动跳转）
- 原生管理界面：http://127.0.0.1:18001（私有管理员凭据不传给聊天浏览器）
- 原生日志：`instance/logs/launcher.log`，可能包含管理信息，不要公开。

首次启动由用户接受官方 EULA 与隐私条款。安装器与配置器不创建确认文件，不自动签署。主服务未连接时页面明确不可聊天，绝不回退旧引擎或用固定台词伪装成功。

## 配置和范围

当前一份原生实例对应一位 Yume 和一个本机使用者。另一个账户不能共享该实例，避免把原生管理员级记忆服务误当成多租户隔离。每个网页聊天映射独立原生私聊，实例人格、插件与学习状态属于同一位角色。

- 对话：OpenRouter `deepseek/deepseek-v4.1-flash`。
- 文本向量：OpenRouter `qwen/qwen3-embedding-8b`，4096维。
- A_Memorix 总开关、画像/事实/摘要写回和启发式召回开启，按原生流程执行。
- 插件 Runtime 开启；没有安装来源不明的社区插件。
- 遥测与外部 MCP 关闭，所有服务只监听 loopback。
- 图片向量保持关闭；媒体动作插件已接入表情包、语音和 OpenRouter 生图照片，动作是否发送由原生 Planner 决定。关系向量化保持上游默认关闭，不把“完整原生实现”称为“每个可选功能均启用”。

旧自写聊天系统与历史仍在 `experiments/character-chat` 归档，但新女友页、消息桥接、网关及启动器不执行它的任何 AI 逻辑。AI 酒馆保持原有独立系统。

## 验证

`node --test experiments/maibot-native/tests/*.test.mjs` 验证传输协议、连续收件、重连/幂等和错误；不是聊天质量评分。

`npx tsx --test src/app/api/xumeng/companion/bridge.test.mts` 验证页面账户归属、单实例所有者限制及路由白名单。

原生记忆启动和真实检索使用 `verify-native-memory.py`，详见 [MEMORY-INTEGRATION.md](MEMORY-INTEGRATION.md)。配置成功、Runtime运行、记忆实际写入和聊天体验是四项不同结果，分别记录在 evidence，不能互相代替。
