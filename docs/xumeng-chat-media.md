# 叙梦 VIP 消息语音与剧情图片

> 当前开关（2026-10-15 用户指令）：新图片/视频生成暂时关闭，自动迭代不得自行重开。独立工作台、聊天生图、电话独立素材生成、Krea2 均暂停；语音、电话、已有结果和旧任务恢复保留。验收与版本见 `output/xumeng/iteration/generation-payment-pause-20261015/round.json`。历史实现说明保留，不代表当前开放状态。

后端入口是 `cloudflare/dzmm/src/chat-media.ts`，由应用在 `requireUser` 之后调用 `handleChatMedia(request, env, user)`。数据库迁移为 `0017_chat_media.sql`、`0018_chat_media_wav.sql` 和 `0044_chat_media_credit.sql`。聊天图片每次预留并扣除 100 Credit，失败释放；语音仍沿用 VIP 权限和每日额度，不额外调用文本模型。

## 启用与会员权限

需要 Workers AI 的 `AI` 绑定、已有的私有 R2 `MEDIA` 绑定，以及 `CHAT_MEDIA_ENABLED="true"`。缺少任一项时，列表的 `features.audio/image` 都为 `false`，新生成返回 503。功能默认关闭；开启前先完成迁移并确认绑定可用。测试使用本地临时 D1/R2 和模拟 AI，不访问远端数据库、secret 或真实模型。

语音权限来自当前账户 `subscription_periods` 中 `starts_at <= serverNow < expires_at` 且 `revoked_at IS NULL` 的真实会员记录；聊天图片只要求正式账户和足够的 Credit，不要求 VIP。`super` 正式账户可管理员预览，列表以 `vip.adminPreview=true` 标明，`vip.active` 不因此变为 true，数据库不因此生成付费订阅。VIP 新权益为每日签到 500 Credit，历史订单继续按冻结权益结算。

## 接口合同

生成前，前端先完成云端保存；正文从本账户的已保存 assistant 消息读取。接口不接受文字、提示词、模型名、价格或用户提供的生成配置。

`POST /v1/chat-media/generate` 的 JSON 只能包含以下四个字段，不需要 requestId：

```json
{"accountId":"账户ID","conversationId":"会话ID","messageId":"消息ID","kind":"audio"}
```

`kind` 为 `audio` 或 `image`。成功首次生成返回 201，复用已有素材返回 200：`{accountId,asset}`。账户切换返回 409，不属于当前账户、未保存或非 assistant 消息返回 404。同一素材已在生成时返回 409，并附 `retryAfter:3`。参数错误为 400；每日额度或分钟请求限制为 429；模型/存储错误为脱敏的 502；语音 90 秒、图片 120 秒超时为 504。

`GET /v1/chat-media?conversationId=<id>` 返回稳定字段：

```json
{
  "accountId":"账户ID",
  "conversationId":"会话ID",
  "vip":{"active":true,"expiresAt":1793836799000,"adminPreview":false},
  "features":{"audio":true,"image":true},
  "limits":{"audio":20,"image":5,"maxVoiceChars":800},
  "usage":{"audio":1,"image":0},
  "assets":[]
}
```

`features` 表示服务器绑定和开关可用，会员生成权限单独看 `vip.active || vip.adminPreview`，游客禁止生成。`usage` 是全账户当天的 pending 与成功总数，不是本会话次数。`assets` 仅返回仍匹配当前正文 SHA-256 的 ready 素材；`pending` 单独返回有效的生成占位，具体约束见本文的刷新恢复说明。

素材结构为 `{id,conversationId,messageId,kind,url,sourceHash,createdAt,mimeType}`；音频另外包含 `audioTextChars`、`totalTextChars`，供前端说明长文本截断。`sourceHash` 为原始消息正文 UTF-8 的小写 SHA-256，不是清理后的文字；时间戳为服务器毫秒数。URL 固定为 `/api/backend/v1/chat-media/assets/<id>`。音频按文件头检测为 `audio/mpeg` 或 `audio/wav`，图片为 `image/jpeg` 或 `image/png`。R2 音频对象使用通用 `.audio` 后缀，下载文件名依真实格式选择 `.mp3` 或 `.wav`；历史 `.mp3` key 继续可读。

`GET /v1/chat-media/assets/<id>` 要求登录属主、关联消息存在且当前正文 hash 匹配；缺少或归属不匹配一律 404。已生成的素材在会员到期后仍可由属主读取。后端返回正确 Content-Type、`private, no-store` 和 `nosniff`；主站网关统一使用 `no-store`，不允许公共缓存。MP3/WAV 支持单个 `Range: bytes=...`，有效范围返回 206/Content-Range，非法、多段或超出范围返回 416。图片不支持 Range。媒体代理保留 Cookie 和 Range 请求头，并保留 Content-Type、Content-Length、Content-Range、Accept-Ranges 响应头。

## 配额、幂等与并发

每日额度为语音 20、图片 5，按服务器 UTC+8 日历日计算。pending 提前占位，失败释放；同账户每 60 秒最多六次新生成尝试，缓存命中及已经 pending 的同素材不再次触发模型。成功素材以 `user_id/conversation_id/message_id/kind/source_hash` 唯一，重复请求返回同一素材。

配额占位、Credit 预留、保存的消息内容比对、数据库中的正式账户/VIP或super检查、素材唯一锁在同一个 D1 原子 batch 内完成。只有赢得占位的请求才运行 AI；不同消息同时申请最后一个额度时也只有一个能调用模型。失败重试复用素材 ID，但使用新的处理 token 与新的 R2 对象 key，旧请求不能提交新请求的结果。

`chat_media_assets` 使用 messages 的账户/会话/消息复合外键并 `ON DELETE CASCADE`。`chat_media_usage` 独立保留成功额度，因此删除或重建消息不会恢复当天已用额度。正文改变后旧素材不可列出和读取；新正文需要新的素材与额度。生成前按 SQL 确认正文；AI 返回后再次 hash 比对；写入 R2 后的 D1 完成步骤再次原子比对消息全文，变化时拒绝提交并删除本次对象。

pending 具有生成超时加 30 秒的租期。请求明确失败时立即释放；进程异常终止留下的 pending 会在后续请求中到期清理。Workers AI 绑定不提供取消已发出的推理操作，本地超时会阻止其结果写入数据库/R2，提供方可能仍完成已收到的推理。超时后重试可能产生提供方已计费但未保存的第一次结果。

消息删除只删除 D1 素材记录，私有 R2 原对象成为无法通过素材 API 读取的孤立对象；日常存储清理可按保留周期处理。R2 写入或后续数据库提交失败时会尝试删除本次对象；若 R2 删除也失败，对象仍不可通过 ready 素材接口访问。新功能没有开放公开 R2 URL。

## 模型与内容处理

语音调用 [`@cf/myshell-ai/melotts`](https://developers.cloudflare.com/workers-ai/models/melotts/) 的 `{prompt,lang:"zh"}`。去除 HTML、Markdown 标记、URL 与代码块，按 Unicode 字符截取前 800 字，保留对话正文。支持有上限的 ReadableStream、Uint8Array/ArrayBuffer 或 `{audio:base64}`，模型运行和音频流读取共享 90 秒期限，读取超时取消流。检查 12 MiB 上限、MP3 文件头或 WAV 的 RIFF/WAVE 长度、fmt/data 与 PCM 参数。Cloudflare 文档标注 MP3，但本次线上 MeloTTS 实际返回 WAV，未压缩音频较大，因此单段保守限制 800 字；长消息播放器会标明实际朗读字数。Cloudflare [`Ai.run` 实现](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts) 对非 JSON 响应返回音频流。

图片调用 [`@cf/black-forest-labs/flux-1-schnell`](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/) 的 `{prompt,steps:4}`，提示词最长 2048 字符。只读取这条 assistant 消息，从中选择环境、光线和普通动作句子，去除明显露骨/未成年性化句子及提示词指令；中文正文按预置词表提取英文环境、光线、衣着和物件描述，避免直接中文提示导致无关画面或乱码字幕，不额外调用翻译/文字模型。词表不能完整翻译任意故事，也不保证人物外观连续一致。没有可用场景时使用普通风景。固定提示要求成人、完整着装、普通姿态与适合公开观看，并禁止文字、字幕、标志及边框。这是规则过滤和安全提示，并非完整内容审核服务。输出要求 `{image:base64}`，检查字节上限 10 MiB 与 PNG/JPEG 头信息。不会额外读取人物资料或其他账户内容。

## 本地验证

```sh
cd cloudflare/dzmm
node --test test/chat-media.test.mjs
npm run check
```

测试覆盖严格参数、账户隔离、游客/会员过期/撤销、管理员真实预览、语音中文输入与二进制/base64结果、图片场景与长度、缓存、并发唯一调用、并发末尾额度、失败重试、R2失败回收、已提交后读取失败/完成响应丢失、超时、正文变化、MP3 Range 与 UTC+8 跨日。所有 AI 响应为本地模拟，不产生真实推理调用。

## 2026-10-06 发布验证

- 后端版本 `a1c6e78a-3d80-4fc3-b46c-16f78079ba4f`，网页版本 `d9339fc2-6148-4666-8953-a2331496dcdf`；`0017` 与 `0018` 已应用，主站 `https://xumengchat.top/#vip` 显示 ¥28/30 天、签到 500 Credit、语音每日 20/图片每日 5、单段 800 字。
- 全部后端测试 188/188、网关 76/76、相关聊天/记忆/支付/媒体客户端 58/58 通过；类型检查与改动文件 ESLint 通过。WAV 迁移另以临时真实 D1 验证旧素材各列和值、额度记录、无关账本和序列均保留。
- 线上最终完整检查 21/21：各一次真实音频/图片生成 201、下载 200、音频 Range 206/20 字节、刷新保存、缓存 POST 不增加 D1 额度、跨账户素材及会话 404、游客生成和跨源 POST 403。两个测试账户与两个 R2 对象清理完成，相关 D1 数据剩余 0。
- 最终 WAV 为 1,836,226 字节，PCM16 单声道 44.1 kHz、20.818 秒；本次验证文件格式和取回，不宣称人工试听过语音自然度。最终 JPEG 722,323 字节，目视可见书店、高窗日光、木桌旧地图和蓝色衬衫成年店员；地图上的标签和画面边框仍可能由模型生成，不保证严格无文字或无边框。
- 总计 5 次首次音频请求（前 4 次返回解析失败，最后 1 次通过）、2 次图片请求（第一张中文提示画面不准确，改为英文场景要素后第二张匹配）。未发送文字模型请求、邮件、付款、会员购买或每日 Credit 领取；管理员预览没有创建付费会员期间。
- 最后线上报告 `output/xumeng/chat-media-live-2026-10-06T06-06-09-096Z.json`，原始失败报告保留。网页模拟交互另验证更多菜单、登录/VIP引导、单段互斥播放、图片放大/关闭和旧加载响应不能覆盖新素材；模拟音频是无声 MP3，不能替代模型声音质量判断。
# 媒体故障恢复（2026-10-07）

会话素材目录读取失败时显示「重新加载素材」，读取恢复前禁用生成菜单，避免把不可读的已有缓存当作新素材。未保存新会话的首次404仍允许先保存再生成。语音和图片提供消息内重载，重载仅核对目录并读取文件，不自动调用模型；语音以实际元数据加载成功确认恢复。成功重读排除已失效的图片时，旧预览同步关闭。

后端在复用 ready 缓存前检查 R2 的存在性、尺寸、所有者和正文指纹；素材读取发现真实缺失也条件失效对应旧缓存。临时存储异常返回503并保留缓存。真实缺失返回404/409及 `media_asset_unavailable`，当前请求不补建；用户明确再次生成时沿用每日额度，原成功用量保留，新模型生成再计一次。条件失效绑定旧 processing token 和 object key，避免迟到读取误伤新成品。

本轮故障恢复通过隔离D1/R2、真实组件本地模拟及正式资源/入口检查验收，没有请求正式语音或图片模型。

## 2026-10-07 生成期间文件重试

另一条消息正在生成素材时，已失败的语音、缩略图和大图预览会禁用重新加载，并显示「正在生成素材，完成后可重新加载」。生成完成后恢复手动重试，避免点击被 Provider 的读取保护静默忽略。重试仍只读取目录和文件，不自动重新生成，不改变权益或额度。

第十四轮以普通原创本地素材验证两种文件故障、另一条生成挂起、等待说明和完成后的恢复。实际音频元数据2.997188秒、图片828×552，手动重试前后生成POST均为1。另验证原生图片预览故障和恢复后重新打开；失败弹窗与生成并发的busy传参经代码检查，未声称这个组合已有UI验收。正式页核对公开媒体说明及新资源，未执行真实生成或余额操作。详见[第十四轮记录](/Users/pencil/Documents/IntVideoGameEditor/output/xumeng/iteration/rounds/round14-20261007.json)。


## 每条回复的直接入口（2026-10-09）

角色的故事背景、开场白和各轮 assistant 回复下方，统一显示复制、生成语音、生成图片及更多。已有素材时对应切换为播放语音、查看图片，复用保存的私有素材，不再次生成；第一次语音生成完成后展示播放器，由用户点击播放。用户消息仅显示复制与更多，原有右键菜单和键盘操作保留。工具栏支持窄屏换行和明确焦点。

新生成素材的正文投影依据本账户会话的模板开场快照及完整已保存消息前缀匹配，仅在匹配目标开场时使用共享的作者备注解析器取故事正文。作者致谢、模型测试说明等不会进入该次媒体提示，故事内的 PS 和普通后续聊天原文保留；只剩作者备注的开场在占用额度前返回400。消息原文、sourceHash、保存和缓存合同保持一致，已有旧素材不会自动删除或重新生成。

语音需要正式 VIP 或 Super；聊天图片不要求 VIP，按每次约 100 Credit 扣费，仍受每日图片 5 次和频率限制。语音每日 20 条、前 800 字。图片为当前段落的场景插画，不承诺人物外观一致或可选声线。

本次验证分层记录在 `output/xumeng/chat-media-actions-20261009/`：真实组件与本地模拟接口完成常显入口、保存后生成、缓存播放／预览、刷新、生成锁、登录／权益提示和窄屏布局；31项隔离D1/R2媒体测试验证备注投影及原权限、缓存、并发与失败恢复。未新增实际付费媒体调用，不能把模拟风景图和无声音频称为本次模型成品。

本次上线版本：网页 `cdac9d97-ff82-475b-9a91-95deb0cc0200`、后端 `0bfd39f8-a0a6-49e0-84aa-460bd05571b1`。正式 HTML、JS、CSS 及关键素材24项逐字节匹配，匿名session接口200；功能操作验收为本地真实组件与隔离API，不冒充本次真实供应商生成。完整轮次见 `output/xumeng/iteration/rounds/chat-media-actions-20261009.json`。

## 2026-10-10 成功回包丢失与刷新恢复

每条 assistant 消息的媒体恢复按消息ID、audio/image类型和当前原文SHA精确匹配。生成前先保存会话，再读取已有成品或有效占位；有匹配记录即复用，不为检查状态重复提交。POST回包失败后只读取一次目录核对成品，读取也失败时展示「检查生成结果」并暂时禁用对应类型的生成。恢复查询只发GET，不建立任务或增发额度；旧接口缺少pending字段时，已提交但未确认的结果仍视为未知。

目录的新pending数组来自与ready成品同一条SQL查询，要求本人会话、当前assistant原文、原processing token对应的usage回执、同owner/asset/kind和未到期租期均匹配；只返回id/messageId/kind/sourceHash/expiresAt。expiresAt为服务器租期，客户端不按本地时钟释放任务。原GET的到期占位清理保留，因此「只读恢复」指不提交生成任务，不承诺接口完全没有既有清理写入。

生成中刷新后，页面继续显示等待说明并提供手动检查；原任务完成时取回同一私有素材。权限、VIP每日语音20／图片5、Credit、价格及供应商均没有改变。断连后的Worker运行生命周期和真实供应商取消能力未新增保证。

本轮旧生产相同冻结页面复现两个问题，最终冻结页面验证自动恢复、恢复GET503后的手动检查、pending刷新和原生成结果取回。实际隔离D1/R2接真实组件，供应商只返回本地PNG／静音WAV；最终3次生成POST、3次模拟AI、图片额度2／音频额度1，恢复不增加用量。原生图片320×180、音频2秒播放结束且无错误。客户端10项与隔离后端34项测试、相关类型检查通过；完整混合Worker/Node/浏览器检查保持已知未通过，同指纹不重跑。证据见 `output/xumeng/iteration/heartbeat-20261010-chat-media-recovery/acceptance.json`；手机和真实模型音质、画质不在此次验收范围。

最终一次构建后，网页和后端各发布一次：网页 `144c5da0-a45c-4d6e-844d-cd362bf002f2`，后端 `b883f600-5abb-4add-8127-b26c7d0cef2a`。正式站44项HTTP检查通过，37个资源与验收构建字节匹配；游客浏览器实际加载 `/assets/index-Dn9PZBWC.js` 和 `/assets/index-Bai1b_w4.css`。生产检查验证资源、服务及身份门禁，恢复操作的验收来自隔离页面和实际D1/R2。测试账户、素材、浏览器备份和临时服务均已清理；完整记录见 `output/xumeng/iteration/heartbeat-20261010-chat-media-recovery/round.json`。
