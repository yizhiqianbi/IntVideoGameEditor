# xumeng-gen 原型：生图与视频改用腾讯云接入包（2026-11-18）

原型 `xumeng-gen`（https://xumeng-gen.vercel.app）的生图、图生视频、换脸生图、换脸视频四条生成路径切换到
`腾讯云AI接入包-H3fast-ImageLite-20261118` 提供的两套服务。旧的 Seedream / 云桥 Wand / huanlian 代码保留在
`lib/` 里，路由仍能查询旧任务号；要回退时改回路由即可。

## 服务与凭据

| 用途 | 服务 | 环境变量 |
| --- | --- | --- |
| 生图（文生图/参考图生图/换脸生图） | WAND-Vega-Image-1.0-Lite（TokenHub 国际站） | `TOKENHUB_BASE_URL`、`TOKENHUB_IMAGE_LITE_API_KEY`、`TOKENHUB_IMAGE_LITE_MODEL` |
| 视频（图生视频/换脸视频） | MiniMax H3 fast（EdgeOne Makers 网关） | `H3_BASE_URL`、`H3_API_KEY` |

凭据只放在 Vercel 项目环境变量（production / preview / development）和本地 `xumeng-gen/.env.local`，不入库。
`GET /api/health` 会返回 `image`、`video` 是否就绪以及模型名。

## 图片：Image Lite

- 提交：`POST /v1/wand/vega-images/generations`，`model=wand-vega-image-lite`，`prompt`，`size`，
  参考图放在 `input[].content[]`，类型 `input_image`。
- 查询：`GET /v1/wand/vega-images/tasks/{task_id}`，`queued/in_progress` 继续查，`completed` 取 `data[].url`。
- 尺寸使用本轮实测过的 1K 档：`1024x1024`、`1024x1536`（竖）、`1536x1024`（横）。
- 结果图片（PNG）由函数下载后直接回浏览器；参考图必须先放到渠道能公开读取的 https 地址
  （现在统一走 `channel-media` 素材库）。
- 页面路径：AI生图 `/api/text-image`；换脸生图 `/api/face-swap` 的图片分支。
- AI生图支持带 0–2 张参考图（页面两个卡位），`buildTextImage` 最多放过两张；Image Lite 本身支持最多 10 张，
  要再加卡位只需放宽这个上限。
- 换脸生图的提示词仍来自 `components/modules/prompt-defaults.js`，路由会把 `<image1>/<image2>` 换成
  「第一张参考图 / 第二张参考图」再发给 Image Lite。

## 视频：WAND-Vega-Video-1.5-Lite（图生视频）+ huanlian（换脸视频）

2026-11-19 定稿路线：**图生视频用腾讯云 TokenHub 的 WAND-Vega-Video-1.5-Lite，换脸视频用 huanlian**。
H3 fast 保留为可切换的备用通道（`TENCENT_VIDEO_PROVIDER=h3`）。

### WAND-Vega-Video-1.5-Lite：图生视频（当前默认）

- 提交：`POST https://tokenhub-intl.tencentcloudmaas.com/v1/wand/vega-videos/tasks`，
  `model=wand-vega-video-1.5-lite`；查询 `GET /v1/wand/vega-videos/tasks/{id}`，
  `succeeded` 后取 `content.video_url`。
- 凭据：复用 `TOKENHUB_*`（默认用 `TOKENHUB_IMAGE_LITE_API_KEY`；可用 `TOKENHUB_VIDEO_LITE_API_KEY` 单独配）。
  模型名可用 `TOKENHUB_VIDEO_LITE_MODEL` 覆盖。
- 参数：`resolution` 480P / 720P / 1080P / 2K（1.5-lite 实测这四个可用；768P 会报 invalid）；
  `duration` 4–15 秒；首帧用 `role=first_frame` 且不传 ratio。
- 实测：720P 文生视频 4 秒输入 → 5.79MB / 1280×720 / h264+aac，任务耗时约 6–7 分钟（比 H3 慢）。
- 页面路径：图生视频 `/api/image-video`；成片同样转存 channel-media 后回地址。

### H3 fast：备用图生视频通道

- 提交：`POST /minimax/v2/video_generation/fast`；查询：`GET /minimax/query/{task_id}`，
  `running` 继续查，`succeeded` 取 `task.content.url`。
- 参数：`duration` 4–15 秒整数；`resolution` 720P；首帧模式用 `role=first_frame` 且不传 ratio。
- 成片下载后经签名直传存进 `channel-media` 素材库，浏览器拿到的是
  `https://channel-media.xumengchat.top/api/studio/media/...`，腾讯临时签名地址不直接给用户。
- 切回方式：环境变量 `TENCENT_VIDEO_PROVIDER=h3`。

### huanlian：换脸视频（原视频保留，只换脸）

- 页面路径：`/api/face-swap` 的视频分支，实现在 `xumeng-gen/lib/huanlian.mjs`。
- 提交 `POST {AIAPI_BASE_URL}/api/public/huanlian`（form：`video_url`、`img_url`、`positive_prompt`、
  `video_format`），查询 `GET /api/public/task?task_id=`，`status=2` 取 `out_data[]` 里的成片地址。
- 像素级换脸：背景、发型、身体、动作、镜头都保留，只替换五官；成片约 10–20 秒。
- 供应商回执带 `fee`（当时 10）和 watermark 标记；成片同样转存到 `channel-media`。
- 素材限制：30 秒、64MB。

### H3 不能做换脸视频（实测结论）

- H3 全能参考（`reference_image` + `reference_video`）只会「保留参考视频原角色」或「整段按参考图重生成
  画面」，拿不到「原视频不变、只换脸」。
- 9 组 prompt 对照（含具体可见描述、复测、否定式、英文、通用模板），按真换脸标准成功 0 次；
  否定句会反向保留原角色，`first_frame`/`last_frame` 与 `reference_*` 混用直接 400。
- 证据与 prompt 样本：`.agents/skills/h3-face-swap-video/references/prompt-experiments.md`、
  `output/xumeng/h3-prompt-experiment-20261119/`；huanlian 真换脸对比：
  `output/xumeng/h3-face-swap-skill-20261119/verify/live-huanlian-check.jpg`。

## 交互与存储

- 浏览器按任务号轮询：图片 4 秒一次，视频 8 秒一次（对应供应商建议的查询频率）。
- 视频任务结果超过 Vercel 4.5MB 响应上限，所以接口只回成片地址，不再回视频字节。
- 本地联调时 Node 请求腾讯接口需要代理（`NODE_USE_ENV_PROXY=1` + 系统代理变量）。
