---
name: h3-face-swap-video
description: >-
  Produce and QA face-swap video for the xumeng-gen prototype with Tencent's
  MiniMax H3 fast (全能参考), and pick the correct route when H3 cannot hold
  identity. Covers reference-image + reference-video prompting, duration and
  resolution parameters, channel-media hosting, task polling, result
  re-hosting, identity QA frames, and the huanlian pixel-swap fallback. Use when
  asked to 用 H3 做换脸视频 / 视频换脸 / 角色替换视频 / 参考视频重演, or to debug
  identity drift, the wrong face, 400 first_frame mixing, or result storage.
---

# H3 换脸视频（本仓库）

线上实现：`xumeng-gen` 的 `/face` 视频分支，模型是 MiniMax H3 fast（腾讯云 EdgeOne 网关）。
本 skill 负责：判断该不该用 H3、怎么调、怎么验收、什么时候退回 huanlian。

## 先看结论：H3 全能参考不等于换脸

实测（2026-11-19，线上真实调用，样本见 `references/evidence.md`）：

- H3 的 `reference_image` 只是人物外观参考，`reference_video` 的主体权重明显更强。
- 结果只有两种：**要么保留参考视频原角色**（身份没换），**要么整段画面按参考图重新生成**
  （场景/镜头/服装变了，不是原视频）。两种都不是「原视频不变、只换脸」。
- 提示词里写「不要保留参考视频里原来的脸和身份」压不住；把换脸后的首帧作为参考图（预热）同样无效。
- H3 **没有**精确视频换脸模式：`first_frame`/`last_frame` 与 `reference_*` 不能混用，接口直接 400：
  `first_frame/last_frame and reference_* cannot be mixed`。
- 同一输入两条路线实跑对比：H3 153 秒且画面被重生成；huanlian 21 秒、原画面保留、身份换成功
  （`output/xumeng/h3-face-swap-skill-20261119/compare-strip.jpg`）。

所以：**不要向用户承诺「H3 换脸视频」能保持身份**。按需求选路线：

| 需求 | 路线 |
| --- | --- |
| 身份必须像参考脸、保留原视频画面 | **huanlian 像素换脸**（稳定，单次调用） |
| 只要参考图角色按参考视频的动作/表情表演，允许重生成画面和场景 | H3 全能参考 |
| 既要快又要给用户选择 | 两条各跑一次，H3 当创意候选，huanlian 当保底 |

## H3 全能参考配置

- 凭据：`H3_BASE_URL`、`H3_API_KEY`（Vercel 项目环境变量；本地在 `xumeng-gen/.env.local`）。
- 提交：`POST /minimax/v2/video_generation/fast`，`Authorization: Bearer <key>`。
- 查询：`GET /minimax/query/{task_id}`，10–20 秒一次，`task.status` = `running` / `succeeded` / `failed`。
- 请求体关键项：

```json
{
  "content": [
    { "type": "text", "text": "<提示词>" },
    { "type": "image_url", "image_url": { "url": "<人脸参考图 https>" }, "role": "reference_image" },
    { "type": "video_url", "video_url": { "url": "<原视频 https>" }, "role": "reference_video" }
  ],
  "duration": 5,
  "resolution": "720P",
  "ratio": "adaptive",
  "remove_audio": false
}
```

- `duration` 4–15 秒整数；`resolution` 768P/720P/480P；参考模式 `ratio` 用 `adaptive`。
- 素材必须是渠道可公开读取的 https 地址：参考图走 `channel-media` 的 `channel-reference`，
  视频走签名直传 `/api/studio/upload`。TOS/edgeone 临时签名地址不要直接当历史地址。
- 成片下载后转存到 `channel-media`，页面拿我们域名下的地址。

## 提示词模板

主模板（线上在用，`xumeng-gen/lib/face-video.mjs`）：

```text
以参考图里的人物作为角色，按参考视频的动作、表情和节奏生成视频。参考视频提供动作、镜头和节奏，参考图提供人物外观和画面风格，不要保留参考视频里原来的脸和身份。人物是虚构的成年人，二十一岁以上。
```

写法要点：

- 用「看得见、生成得出」的句子写动作和镜头，不要写「电影感」「高级」这类空词（参考
  [h3-prompt-standardizer](../h3-prompt-standardizer/SKILL.md)）。
- 参考图/参考视频的分工要写清：谁提供身份、谁提供动作/镜头/节奏。
- 成人内容默认虚构成年角色，末尾带「二十一岁以上」；不要生成未成年或真人身份。
- 不要指望加长提示词解决身份漂移，这是模型能力边界。

## 推荐流程

1. **确认输入**：人脸清晰单人图（JPG/PNG），原视频 ≤15 秒、≤64MB、MP4/MOV。
2. **选路线**：按上面的表格；身份敏感直接 huanlian，不要先试 H3。
3. **跑脚本**（自动上传、提交、轮询、下载、转存、抽帧）：

```bash
node .agents/skills/h3-face-swap-video/scripts/h3-face-swap-video.mjs \
  --face /path/face.jpg \
  --video /path/clip.mp4 \
  --out output/xumeng/h3-face-swap-$(date +%Y%m%d) \
  --route both --duration 5
```

`--route h3` 只跑 H3，`--route huanlian` 只跑像素换脸，默认 `both`。
脚本读取 `xumeng-gen/.env.local`（或环境变量）：`H3_*`、`TOKENHUB_*`、`AIAPI_*`、`CREATE_MEDIA_ORIGIN`。

4. **验收**：
   - `result.json` 里有两条路线的 task id、耗时、成片 URL和本地文件。
   - `frames/` 里每 1 秒左右抽了帧；对比人脸参考图，判断身份是否真的换过去。
   - H3 结果身份不对是预期行为，不要改 QA 标准去「通过」它。
5. **交付**：写清用的是哪条路线、H3 是否只是角色参考重演；身份要求高时给 huanlian 结果。

## 失败与处理

| 现象 | 处理 |
| --- | --- |
| 400 `first_frame/last_frame and reference_* cannot be mixed` | 去掉首尾帧，只留 `reference_image` + `reference_video` |
| 400/403 素材地址无效 | 重新上传到 `channel-media`，确认 https 且公网可读 |
| H3 成片身份漂移 | 记录为模型限制；需要精确换脸改跑 `--route huanlian` |
| 超时 / 任务一直 running | 保留 task id，按原 task id 继续查；不要重复提交 |
| 成片 >64MB 或转存失败 | 缩短时长/降低分辨率；检查 `channel-media` 上传接口 |

## 成本与耗时（实测）

- H3 5 秒 720P：约 35–90 秒任务时间，页面端到端 71–157 秒（含轮询）。
- huanlian 5 秒像素换脸：约 10–20 秒，成片保留原视频画面。
- Image Lite 预热（把脸换到源视频首帧）：+20–30 秒，且对 H3 结果无效，不推荐默认启用。
