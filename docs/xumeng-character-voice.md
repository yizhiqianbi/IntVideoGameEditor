# 角色朗读

小说人物和角色卡可载入角色朗读工作台，编辑台词后生成、播放和下载中文音频。默认台词取人物的对白正文；人物背景和作者备注不会自动混入朗读。单次输入最多 800 个 Unicode 字符，超过上限需由用户分段。

朗读提供 9 个选项，目录来自 `src/lib/xumeng-voices.ts`。默认“自然中文”使用现有 Workers AI `@cf/myshell-ai/melotts`，固定 `lang: zh`；其余 8 个选项使用 Vidu 的真实 TTS 音色 ID，模型标识为 `vidu-tts`。标签描述声音风格，不代表说话者年龄。

| 显示名称 | `voiceId` | 提供方 |
| --- | --- | --- |
| 自然中文 | `melotts` | Cloudflare Workers AI |
| 御姐 | `female-yujie` | Vidu |
| 软萌少女 | `female-shaonv` | Vidu |
| 甜美 | `female-tianmei` | Vidu |
| 成熟 | `female-chengshu` | Vidu |
| 青涩青年 | `male-qn-qingse` | Vidu |
| 清爽青年 | `male-qn-daxuesheng` | Vidu |
| 霸道男声 | `male-qn-badao` | Vidu |
| 沉稳男声 | `male-qn-jingying` | Vidu |

小说人物的 `liveVoice` 用于实时视频聊天；独立朗读使用人物档案中的 `speechVoice`，生成请求对应 `voiceId`。这里的音色属于提供方预置声音，不是人物声音复刻，也不把实时聊天的 Doubao/Qwen 音色 ID 当作朗读选项。官方试听样本可以展示音色风格，但不能证明当前服务端密钥已成功生成该音色。

后端接口：

- `GET /v1/character-voice`：当前账户的会员、启用状态、共享语音额度，以及可用音色 ID 数组 `speechVoices`。`enabled` 表示至少有一个可用音色；为兼容旧客户端，顶层 `model` 仍为默认 MeloTTS 模型。
- `POST /v1/character-voice/generate`：严格接受必填 `accountId`、`name`、`sourceKey`、`text`，以及可选 `voiceId`。省略 `voiceId` 或传 `melotts` 均使用原默认音色；未知 ID 返回 400，未接通的提供方返回 503，不预留额度、不调用另一音色。成功的资产元数据返回所选 `voiceId` 和对应 `model`。
- `GET /v1/character-voice/assets/{id}`：本人私有音频，支持单范围字节请求。浏览器使用 `/api/backend/v1/character-voice/...` 同源代理，不接收提供方输出 URL 或密钥。

生成需要正式账户和有效 VIP，Super 使用现有不限量预览权限。每日语音额度沿用 `chat_media_usage` 中 pending/ready 音频收据，上限 20 次，与聊天消息朗读共享，按 UTC+8 自然日计算；不新增额度池，不改变现有信用点价格。Super 仍受输入、每分钟请求与提供方限制。Vidu 的提供方消耗不是新的用户价格规则。

同账户、相同来源人物、姓名、原始台词、模型和音色命中缓存不会重复生成。不同音色拥有独立指纹和缓存，即使台词完全相同也不会串用结果。默认音色保留原来的哈希序列化 `{name,sourceKey,text,model:"@cf/myshell-ai/melotts"}`，不追加默认 `voiceId`；旧四字段请求、旧资产及旧缓存继续可用。新音色的哈希包含 `model:"vidu-tts"` 与实际 `voiceId`。成功额度不会因 R2 对象丢失而退回；用户明确重新生成使用新额度。

## 私有服务与迁移

默认音色需要后端 Workers AI `AI` 绑定。所有生成需要 `CHAT_MEDIA_ENABLED="true"` 和私有 `MEDIA` R2 绑定。Vidu 通过后端 `cloudflare/dzmm/wrangler.production.jsonc` 中的命名服务绑定调用：`binding: "VIDU_VOICE"`、`service: "dzmm-web"`、`entrypoint: "ViduVoiceService"`。`dzmm-web/src/entry.ts` 导出该 `WorkerEntrypoint`，实现位于 `vidu-voice-service.ts`；它没有公开 HTTP 生成路由，`fetch()` 返回 404。

Vidu 密钥由 `dzmm-web` 服务端 secret `VIDU_API_KEY` 提供，不放入前端 bundle、请求正文、返回素材或后端普通变量。`VIDU_REGION="global"` 使用 `https://api.vidu.com`；其他值使用 `https://api.vidu.cn`。私有服务请求 `/ent/v2/audio-tts`，以清理后的台词和选定音色为输入，固定速度 1、音高 0，并下载提供方音频。内部 RPC 合约为 `configured(): Promise<boolean>` 和 `generate({text,voiceId})`，后者返回 `{bytes:ArrayBuffer,mimeType,providerCredits,taskId}`；任务 ID、提供方消耗及外部文件 URL 不暴露给朗读客户端。

可用目录先检查开关和 R2；MeloTTS 还需 `AI`，Vidu 还需私有绑定及 `configured()` 返回 true。Vidu 不依赖后端 `AI`。当前 `configured()` 只确认服务端密钥非空，不验证密钥权限、余额或实际 TTS 可用性。目录查询失败会隐藏 Vidu 选项；明确选中的 Vidu 音色若未配置、超时或生成失败，会返回错误，绝不静默降级为 MeloTTS。

部署前应按顺序应用 `0032_character_voice.sql` 和 `0033_character_voice_style.sql`。0032 创建私有朗读资产表，外键随账号删除；0033 新增 `voice_id TEXT NOT NULL DEFAULT 'melotts'`，使既有记录保持默认音色语义。两个 Worker 的部署版本应同时包含导出的私有入口和上述后端绑定；2026-10-10 已应用 0033 并按先 Web 私有入口、后账户后端绑定的顺序发布；版本与正式资源核对见 `output/xumeng/voice-styles-20261010/report.json`。

后端在 R2 写入前检查 RPC 输出类型、音频大小及实际 MP3/WAV 字节格式，并要求实际 MIME 与提供方 MIME 一致。R2 对象的账号、资产编号、正文指纹、模型音色配对和字节大小均经过校验。额度预留和缓存锁在同一 D1 批次完成，生成提交时再次检查会话、会员、处理 token 与预留期限；失败释放 pending 收据，过期任务不能回写 ready。错误消息不透出提供方诊断。账号切换会中止前端请求并重新挂载编辑器与播放器；生成失败保留台词和已有结果。

## 已执行验证

2026-10-10 本轮在隔离 Miniflare D1/R2、模拟 AI/私有 Vidu RPC 和模拟 fetch 上执行以下测试，共 55 项通过、0 失败。实际结果来自本轮工具执行的控制台输出，汇总记在下表；没有另存日志文件，也没有使用生产 D1/R2 或调用收费模型。

| 工作目录（相对仓库根目录） | 实际执行命令 | 控制台结果 |
| --- | --- | --- |
| `cloudflare/dzmm` | `node --test test/character-voice.test.mjs` | `tests 19`、`pass 19`、`fail 0`，退出码 0 |
| `cloudflare/dzmm` | `node --test test/chat-media.test.mjs` | `tests 30`、`pass 30`、`fail 0`，退出码 0 |
| 仓库根目录 | `node --import tsx --test src/lib/xumeng-character-voice.test.mts` | `tests 6`、`pass 6`、`fail 0`，退出码 0 |

后端 19 项覆盖旧默认指纹与素材、不同音色缓存隔离、可用目录、Vidu 无 AI 绑定、未知或未接通音色、清理后的台词、私有所有权、损坏 WAV、MIME 不一致、超大音频、超时与失败额度释放，以及共享额度并发竞争、会话撤销和会员/任务过期。聊天媒体 30 项验证原有共享额度、私有缓存、音频格式、范围请求与并发回归。客户端 6 项验证旧响应默认化、音色目录与模型配对、前后端指纹一致、生成响应绑定到所选音色、同源传输和取消请求。

另已执行 `cloudflare/dzmm` 的 `npm run check`，以及 `cloudflare/dzmm-web` 的 `npm run check`（包含 client 与 worker TypeScript 检查），均退出码 0。Next 本地预览与 Cloudflare 前端代理支持朗读资产拖动和长生成请求；上述 55 项统计不包含其他代理或浏览器测试。

实际付费的新音色生成尚未验收。上述隔离测试证明本地接口、存储和契约通过；本轮另有实际发布和正式页面证据，但仍不能证明当前密钥余额与每个新音色的实际生成权限；正式付费验收后应单独记录音色、生成结果和实际提供方消耗。
