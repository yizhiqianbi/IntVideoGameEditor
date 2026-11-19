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

## 视频：H3 fast

- 提交：`POST /minimax/v2/video_generation/fast`；查询：`GET /minimax/query/{task_id}`，
  `running` 继续查，`succeeded` 取 `task.content.url`。
- 参数：`duration` 4–15 秒整数；`resolution` 720P；首帧模式用 `role=first_frame` 且不传 ratio；
  换脸视频用 `reference_image` + `reference_video`，ratio 用 `adaptive`。
- 成片下载后经签名直传存进 `channel-media` 素材库，浏览器拿到的是
  `https://channel-media.xumengchat.top/api/studio/media/...`，腾讯临时签名地址不直接给用户。
- 页面路径：图生视频 `/api/image-video`；换脸视频 `/api/face-swap` 的视频分支。
- 换脸视频的路线判断、执行脚本和实测证据封装在 skill：`.agents/skills/h3-face-swap-video/`（H3 与 huanlian 对比见 `references/evidence.md`）。
- 换脸视频素材限制：15 秒、64MB（H3 成片 4–15 秒）；成片不是像素级换脸，而是「参考图角色重演参考视频的
  动作/表情」，身份偶尔会向参考视频原角色漂移。
- 2026-11-19 分项实测见
  [腾讯模型分项实测](../output/xumeng/tencent-model-tests-20261119/report.md)：6 项全部出片，但换脸视频的
  身份替换不稳定（3 次样本 1 次成功）；`first_frame`/`last_frame` 与 `reference_*` 混用会被接口 400 拒绝，
  H3 没有精确视频换脸模式。需要稳定换脸时把 `/api/face-swap` 视频分支切回旧的 huanlian。

## 交互与存储

- 浏览器按任务号轮询：图片 4 秒一次，视频 8 秒一次（对应供应商建议的查询频率）。
- 视频任务结果超过 Vercel 4.5MB 响应上限，所以接口只回成片地址，不再回视频字节。
- 本地联调时 Node 请求腾讯接口需要代理（`NODE_USE_ENV_PROXY=1` + 系统代理变量）。
