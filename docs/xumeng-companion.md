# 叙梦 AI 女友：原生 MaiBot

2026-10-18 根据用户要求，女友部分改为运行官方 MaiBot 原生 Runner / Worker、内置 A_Memorix 与插件 Runtime。之前自写的 Planner / Replyer 分工适配已退出活跃路径，不再称为“完整移植”。当前正式聊天每条有效助手回复按 2 Credit 结算，创建新会话时可设定性格、说话风格和相处方式；计费与风格验收见 [本轮记录](../output/xumeng/iteration/companion-billing-20261018/round.json)。

本机入口：http://127.0.0.1:3010/xumeng#chat/girlfriend

正式入口：[叙梦 · 聊天](https://xumengchat.top/#chat/girlfriend)。2026-10-18 已发布「故事 / 聊天 / 游戏」三分类和女友页面；最新 Web 版本 `e3d78018-cfbf-439d-a081-d4f79e3db30b` 包含创建风格设置和 2 Credit/条提示。正式首页、新 JS/CSS 已与冻结构建逐字节核对。

**正式女友聊天已接入 Cloudflare 宿主。** 页面会先检查登录、宿主就绪和 Credit 余额；未登录或容量暂不可用时明确返回状态，不回退到旧自写引擎。当前尚未发送正式模型消息，因此原生真实回复、风格效果、闲置恢复和满载容量仍不计为已验收；避免用一次健康检查代替真实对话证据。计费与发布边界见 [本轮记录](../output/xumeng/iteration/companion-billing-20261018/round.json) 和 [Cloudflare 部署说明](./xumeng-companion-cloudflare.md)。

消息页分为「故事 / 聊天 / 游戏」。现有角色扮演会话属于「故事」；AI 女友位于「聊天」中的 Yume 条目，点击后在同一聊天主栏打开；「游戏」直接列出自己的可玩作品，不再设置「全部」和「查看游戏」跳转按钮。顶部主导航不提供并列女友入口；旧 `/xumeng/girlfriend` 链接重定向到 `#chat/girlfriend` 并选中「聊天」。女友历史通过聊天头部切换，不增加第二个侧栏。

启动：`node scripts/xumeng-companion-dev.mjs`。官方源码、锁定依赖、独立实例配置、消息网关与说明位于 [experiments/maibot-native](../experiments/maibot-native/README.md)。

网页只做消息传输。AI 对话决策、提示词组装、工具调用、分条发送、主动行为、记忆均由官方实现负责。原生连接不可用时直接显示不可用，不回退旧自写引擎。

正式环境按账号隔离 Yume 会话，每个账号使用自己的 Durable Object；当前同时运行上限为 5 个实例，容量满时明确提示稍后重试。计费预检失败不会写入待确认回执，用户可在补足 Credit 后重新发送。保留 AI 酒馆；旧女友历史只归档，不导入原生记忆，避免把之前的错误台词和测试事件当成新角色事实。

完整原生代码已安装不等于已验证所有功能。首次启动须用户接受官方 EULA/隐私条款；运行健康、记忆持久化和多轮真实聊天的证据分别记录，未验证项不标完成。

本次实际验收见 [原生接入记录](../experiments/maibot-native/evidence/acceptance-2026-10-18.md)：原生 Runtime、A_Memorix、插件进程与真实长期记忆召回均已运行；重复话题与沉默后的主动性尚未达标，未包装为已解决。
