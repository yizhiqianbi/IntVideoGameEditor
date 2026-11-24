# 实测证据：H3 全能参考 vs huanlian 视频换脸

测试时间：2026-11-19，线上真实调用；输入为 xumeng-gen 原型里的真实素材。
结论：**H3 全能参考不能当换脸视频用**；身份稳定、保留原画面的换脸要走 huanlian。

## 样本 1：H3 沿用参考视频主体（身份没换）

2026-11-19 分项实测第 6 项：

- 参考图：bob 头金发女性；参考视频：前一条 H3 图生视频（双丸子头女性，夜晚街道）；
- 提示词：`以参考图里的人物作为角色……不要保留参考视频里原来的脸和身份。`
- 结果：成片人物仍是参考视频里的双丸子头女性，参考图身份没有进来。
- 产物：`output/xumeng/tencent-model-tests-20261119/06-face-swap-video.mp4`

同一天更早的线上 UI 测试（参考图=金发女性、参考视频=鲨鱼角色素材）同样保留了视频原角色。

## 样本 2：首帧预热无效

2026-11-19 对照实验：

1. 用 Image Lite 把目标脸换到参考视频首帧上，得到「目标身份 + 原视频场景」的预热图；
2. 把预热图作为 H3 `reference_image`、原视频作为 `reference_video` 提交；
3. 结果：H3 成片又回到参考视频原角色（双丸子头女性），预热图没有起作用。

另外尝试「首帧=参考图 + 参考视频」的写法被接口直接拒绝：

```
HTTP 400 first_frame/last_frame and reference_* cannot be mixed
```

## 样本 3：同一输入跑两条路线（skill 脚本实测）

命令：

```bash
node .agents/skills/h3-face-swap-video/scripts/h3-face-swap-video.mjs \
  --face /tmp/scene.webp \
  --video output/xumeng/tencent-model-tests-20261119/05-image-to-video-5s.mp4 \
  --out output/xumeng/h3-face-swap-skill-20261119 \
  --route both --duration 5
```

产物：`output/xumeng/h3-face-swap-skill-20261119/`（`result.json`、两条 mp4、`frames/`、`compare-strip.jpg`）

| 路线 | task id | 耗时 | 成片 | 结果 |
| --- | --- | --- | --- | --- |
| H3 全能参考 | `ref2val4b1-s8-b333b097-…` | 153 s | 592,358 B | 身份接近参考图，但**整段画面按参考图重生成**（室内/白上衣），原视频的街道/镜头没有被保留 |
| huanlian 像素换脸 | `skill-huanlian-f4607786-…` | 21 s | 808,548 B | 原视频画面、动作、镜头保留，脸换成参考图人物 |

对比图（左=参考脸，中=H3，右=huanlian）：`output/xumeng/h3-face-swap-skill-20261119/compare-strip.jpg`

## 汇总

- H3 对「参考视频原主体」的跟随强于对 `reference_image` 的跟随；结果要么保留视频原角色，要么整体
  按参考图重生成场景，拿不到「原视频不变、只换脸」。
- 提示词加强、首帧预热都不能改变这一行为；`first_frame` 与 `reference_*` 不能混用。
- 要稳定换脸视频：走 huanlian，单次约 10–20 秒，原视频画面保留；H3 只用于「角色参考重演」类生成。

## 结论修正与 huanlian 线上验证（2026-11-19，用户指出「都没换脸成功」）

- 按真·换脸标准（原视频画面/身体/服装保留、只换脸）重判：H3 的 9 组 prompt 对照 **真换脸成功 0 次**。
  P3 只是场景和动作接近，服装/身体仍来自参考图。
- 线上 `/face` 视频分支已切回 huanlian（`xumeng-gen/lib/huanlian.mjs`，任务号 `face-video-*`，
  成片转存 channel-media）。
- 同组素材线上实测：`output/xumeng/h3-face-swap-skill-20261119/verify/live-huanlian-check.jpg`
  （左 1 = 参考脸；之后每对为源视频 / huanlian 结果：背景、双丸子头、肩线、眨眼与头部时间点一致，
  只有五官换成参考脸）。
- 线上接口实测：提交返回 202，约 2 次轮询（8 秒级）后拿到成片地址，808,548 B，21 秒级完成。
