# XUMENG 女友图片生成

女友聊天的照片动作使用 OpenRouter Image API 的专用端点：`POST https://openrouter.ai/api/v1/images`。Worker 只在服务端读取密钥，解码返回的 `data[0].b64_json`，再把图片字节交给媒体动作层；Provider URL、请求密钥和上游错误不会下发给浏览器。

实现位于 [`cloudflare/dzmm-web/src/openrouter-image-service.ts`](../cloudflare/dzmm-web/src/openrouter-image-service.ts)。模型通过 Worker 变量配置，不写死在前端。OpenRouter 的图片模型名称和参数会随目录变化，发布前应使用 `GET /api/v1/images/models` 检查模型是否支持 `output_modalities=image` 以及 `resolution`、`aspect_ratio`、`quality`、`input_references` 等参数。

当前 Worker 已有 `DZMM_API_KEY` 和 `DZMM_BASE_URL` 这组聊天配置，图片服务兼容它们，也接受单独的变量：

```sh
wrangler secret put DZMM_API_KEY
wrangler secret put OPENROUTER_API_KEY # 若想为图片单独使用密钥
wrangler deploy
```

可配置变量：

```text
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_IMAGE_MODEL=<从 /api/v1/images/models 选择>
OPENROUTER_IMAGE_QUALITY=medium
OPENROUTER_IMAGE_RESOLUTION=1K
OPENROUTER_IMAGE_ASPECT_RATIO=1:1
OPENROUTER_IMAGE_OUTPUT_FORMAT=webp
OPENROUTER_IMAGE_PROVIDER_ORDER=google-ai-studio,google-vertex
```

也可以使用兼容命名：`DZMM_BASE_URL`、`DZMM_IMAGE_MODEL`；若代码运行在原生 Companion 容器，则使用 `COMPANION_OPENROUTER_API_KEY`、`COMPANION_OPENROUTER_BASE_URL` 和 `COMPANION_IMAGE_MODEL`。不要把密钥放进 `vars`、静态资源或浏览器请求体。图片生成属于付费请求，OpenRouter 文档说明图片 API 需要账户余额超过预授权阈值；应由媒体动作层增加关系阶段、冷却时间和用户级额度，避免每条消息都触发生成。

服务默认只接受 HTTPS 的 `openrouter.ai` 主机，拒绝任意自定义上游地址，避免 Worker 配置被变成 SSRF 入口。参考图片仅允许 HTTPS URL 或 `data:image/png|jpeg|webp;base64,...`，最多四张；响应只接受 PNG、JPEG、WebP 或声明为 SVG 且确实以 `<svg` 开头的字节。

## 原生女友媒体动作

原生 MaiBot 的女友插件位于 [`experiments/maibot-native/plugins/xumeng_media/plugin.py`](../experiments/maibot-native/plugins/xumeng_media/plugin.py)，由 Planner 按上下文选择 `xumeng_send_photo`。默认使用 `x-ai/grok-imagine-image-2.0`、`1K`、`medium`；Grok 的质量参数不接受 `auto`，部署时可通过 `COMPANION_IMAGE_MODEL`、`COMPANION_IMAGE_RESOLUTION` 和 `COMPANION_IMAGE_QUALITY` 调整。媒体结果只在服务端转成原生 image segment，再由网关转成 `message.media`。

语音动作使用同一套 OpenRouter 密钥和 `x-ai/grok-voice-tts-1.0`。表情包优先读取 MaiBot 本地表情库；新实例没有导入表情包时，插件会生成一张本地 SVG 小贴纸，避免用户明确要表情时退化成纯文字。三类动作都有按会话的共享冷却时间（默认 12 秒，同一段时间内最多一个媒体动作），不会每轮自动生成；显式要表情时可单独跳过一次冷却。
