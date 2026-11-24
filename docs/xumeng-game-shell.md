# 叙梦游戏壳

当前容器承载创作中心保存的本人私人 HTML 游戏。保存作品后可通过「游玩 → 游戏」选择，也可在消息列表的游戏分类重新打开。

## 接入边界

- 目录：`#play-games`，调用现有本人游戏元数据接口；正文仅在选中时读取。
- 运行：`#chat/game/private/<gameId>`。`GamePlayer({game: XumengGame, onBack})` 负责外部标题、开始、重载、返回和浏览器支持时的整屏展示。
- 文件：现有 `XumengGame` 合同，UTF-8 源码上限256 KiB。导入／版本保存／恢复由既有 `GameStudio` 与 `xumeng-games-client` 处理，不增加第二套保存接口。
- 交互：HTML 内部负责画面和操作。平台没有自动进度、统一存档、角色状态或钱包桥；「最近打开」只是按账号存于当前浏览器的元数据。
- 隔离：使用原 `buildXumengGamePreview` 的 CSP，iframe 只有 `allow-scripts`，无同源、摄像头、麦克风、账户、模型及支付权限；禁止外部网络。当前适合内联单文件游戏，不宣称外部引擎资源包或任意网络游戏兼容。
- 身份：账号＋作品ID＋版本重置运行窗口；游客不读取私人正文或显示旧本人记录。请求取消、迟到回复、身份错误由库钩子隔离。

主要源为 `src/components/dzmm/game-player.tsx`、`use-game-play-library.ts`、`game-discovery.tsx` 及 `tavern-app.tsx`。组件不得把 iframe 内容自动回写为聊天，也不得把游戏记录称为云存档。

交付证据：[2026-10-12 游戏壳轮次](../output/xumeng/iteration/manual-20261012-game-play/report.md)。生产实际布局／资源与隔离 HTML 运行分层记录；原生重载确认的取消／接受仍受浏览器工具限制。未发布的内置故事／谜题原型已归档，不是当前接入协议。
