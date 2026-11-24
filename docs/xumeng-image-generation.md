# 聊天生图（SillyTavern Image Generation 结构）

## 配置位置

聊天设置 → 模型与预设 → **酒馆式生图（模板 / 负面词 / 自动生成）**，保存后写入账号偏好 `imageGeneration` 并同步云端。

| 字段 | 说明 |
| --- | --- |
| enabled | 启用模板与自动生成（默认关闭） |
| autoMode | `off`（仅 /sd）/ `each`（每条回复）/ `interval`（每 N 条） |
| interval | 1–20，`interval` 模式使用 |
| size | `9:16` / `3:4` / `1:1` / `4:3` / `16:9`，传给站内 seedream 通道 |
| promptPrefix | 正面提示词前缀，支持宏 |
| mainPrompt | 主提示词，支持宏 |
| negativePrompt | 负面词，作为「避免出现：…」追加（通道无独立 negative 参数） |
| injectCharacter / injectScenario | 注入角色外观/性格/描述、场景设定 |

## 宏

`{{char}}` `{{user}}` `{{description}}` `{{personality}}` `{{scenario}}` 等（复用 `src/lib/tavern/macros.ts`）。

## 触发方式

- 手动：消息下「这一幕」按钮；
- `/sd`：在输入框输入 `/sd` 发送，对最后一条角色回复生成画面；
- 自动：开启后，仅对**本次会话中刚流式完成的新回复**按模式触发；切换旧会话不会补生成（避免重复扣费）。

## 代码位置

- 模板引擎/校验：`src/lib/tavern/image-generation.ts`
- 服务端组装与尺寸：`cloudflare/dzmm/src/chat-media.ts`（`composeTavernImagePrompt`）
- 客户端：`src/lib/dzmm-chat-media.ts`、`src/components/dzmm/chat-message-media.tsx`、`src/components/dzmm/tavern-app.tsx`
- 设置 UI：`src/components/dzmm/chat-settings.tsx`

## 未做（需要后端表结构变更）

- 图片多版本 swipe（一张消息多张图切换）：当前 assets 表以 (user, conversation, message, kind, source_hash) 唯一，需要新增 variant 维度与迁移后再做。
- 独立 negative_prompt 参数：seedream 通道暂不支持，暂用「避免出现」拼接。
