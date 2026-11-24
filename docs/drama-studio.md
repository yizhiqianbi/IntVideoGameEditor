# 短剧工作台

入口 `/drama`，顶部导航「短剧生成」。复用项目的 React Flow canvas 技术；原编辑器仍在 `/projects`。无需应用登录。

## 视频配置

- T2V: `minimax/h3-max-turbo/text-to-video`
- I2V: `minimax/h3-max-turbo/image-to-video`
- RI2V: `minimax/h3-max/reference-to-video`（尚未确认 Turbo 参考图端点）
- 服务端固定 `duration: 15`、`resolution: "480P"`、`prompt_expansion_mode: "balanced"`。不会自动切换更昂贵的模型或重试生成。
- fal 密钥在「连接设置」填写，仅保存在页面内存。由服务端按请求创建独立 fal client，不使用全局共享凭证；密钥不会随导出项目保存。
- 首尾帧及参考图填写公开 HTTP(S) URL。RI2V 支持 1–9 张图片，提示词用 Image 1、Image 2 指定用途。
- 使用 fal queue 提交、轮询与取回视频。项目和任务 ID 保存在本机 localStorage；刷新后重新填写密钥即可继续查询。查询失败时点「继续查询已有任务」，不会重新计费。
- 本地草稿可导入/导出 JSON，生成后可打开或下载单镜 MP4。目前不合并整集视频。

## 剧本

`/api/drama/script` 使用独立文本模型，不向视频模型提交剧本请求。在 Vercel 配置 `OPENROUTER_API_KEY`，可选 `OPENROUTER_MODEL`（默认 `minimax/minimax-m2.5`）。缺少配置或上游失败会明确报错；「载入示例故事」为本地示例。

## 验证

`npx tsx --test tests/drama.test.ts`

`npm run build`

## Vercel

已关联项目 `pencilstudio-videogame`。本次本地 token 无效，未部署或修改远端保护设置。恢复 Vercel CLI 授权后执行：

```sh
vercel project protection disable pencilstudio-videogame --sso
vercel --prod
```

在 Vercel 控制台核对项目 Settings → Deployment Protection，并匿名访问线上 `/drama` 验证无需登录。平台保护不能通过修改 Next.js 代码关闭。

## 接口依据

- https://fal.ai/models/minimax/h3-max-turbo/text-to-video/api
- https://fal.ai/models/minimax/h3-max-turbo/image-to-video/api
- https://fal.ai/models/minimax/h3-max/reference-to-video/api

核对日期：2026-09-05。价格以 fal 当日定价为准，界面不写死活动价格。

## 自有 GPU / AutoDL

日常换实例、开机、改公网地址，见 **[短剧 GPU 容器操作手册](./drama-gpu.md)**。一键启动：`./scripts/boot-drama-gpu.sh`。

本地工作台默认选择 ComfyUI；视频 API 请求带 `provider: "comfy"`。任务记录保存独立的 `taskProvider`，切换 fal 后仍会向原服务查询任务。

当前公网映射（随容器变化，以手册为准）：ComfyUI `127.0.0.1:6006`、10Eros `127.0.0.1:6008`。生产环境用 `DRAMA_COMFY_URL` 指向 6006 的 HTTPS 地址，不必本机 SSH 隧道。

启动 SSH 隧道：

```sh
./scripts/connect-drama-gpu.sh
```

脚本使用本机 `~/.ssh/pencil_drama_gpu` 专用密钥，并在断线后自动重连；远端 authorized_keys 将该密钥限制为 ComfyUI 端口转发，不能执行 shell。私钥不在项目内，不保存实例密码。映射 `127.0.0.1:6106` → 实例 `127.0.0.1:6006`。工作台通过 Next.js 服务端访问，浏览器的视频预览经 `/api/drama/media` 回传。没有向公网暴露无鉴权的 ComfyUI。

- 本地 ComfyUI: http://127.0.0.1:6106
- 健康检查: http://localhost:3011/api/drama/health
- 可用 `DRAMA_COMFY_URL` 覆盖默认隧道地址（仅服务端环境变量）。
- 远端 ComfyUI: `/root/ComfyUI`；日志 `/root/pencil-comfyui.log`。
- 镜像原有权重软链接失效，本次权重补全脚本为 `/root/pencil_download_fast.py`，日志 `/root/pencil-download-fast.log`。
- 权重落盘到 `/root/autodl-tmp/pencil-models`，SHA-256 校验后才替换失效链接。数据盘不随镜像保存。
- 自有模型是开源 H3，**不是 fal H3 Max Turbo**。采用镜像自带 Turbo LoRA、SageAttention、8 步 Euler/beta、INT8 主模型、NVFP4 编码器。
- 输出短边 480，横屏 864×480，竖屏 480×864；362 帧 / 24fps ≈15.083 秒。参考图缩放选择 `match` 节省计算量。
- `/pencil/validate` 为远端工作流校验接口，不执行推理。

## 2026-09-06：加速适配与独立生成页

本地入口：http://localhost:3011/video-studio 。Next.js 页面可纳入后续 Vercel 部署，本次未部署。支持 T2V、I2V、参考图输入和 15/30 秒选择，保留 /drama 分镜画布。页面无需登录。实际云部署前需为服务端配置可访问的 GPU 网关；本机 SSH 回环地址不能直接供 Vercel 使用。

原始 Turbo LoRA 的 51 个 AdaLN 层使用 2688 维时间嵌入，而 INT8 pruned 模型只有 8 维时间曲线，导致尺寸不匹配。`scripts/gpu/convert_h3_lora.py` 对社区扩展提供的嵌入网格做带常数项的最小二乘拟合，转换成 ComfyUI 支持的 diff/diff_b 权重。fl2va/ref2va 分别转换，保留原文件。相对网格拟合误差约 0.168%，属于近似适配，不能据此宣称与完整模型画质等价。

网格来源：https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo 。将其 h3_silu_temb_grid.safetensors 保存到 GPU 主机，运行：

```sh
python scripts/gpu/convert_h3_lora.py --grid /root/autodl-tmp/h3_silu_temb_grid.safetensors --source /root/ComfyUI/models/loras/minimax_h3_turbo_4步加速_comfyui.safetensors
```

将 `scripts/gpu/pencil_long_video.py` 放到 ComfyUI/custom_nodes 并重启服务。30 秒采用两段 15 秒顺序采样，用第一段第 360 帧作为第二段首帧，最终各取 360 帧，音频裁切/补齐并淡入淡出至准确 30 秒；不会同时扩大采样窗口。参考图模式的第二段使用 FL2VA，因此需要两套主模型与 LoRA。接点可能有动作、声音或角色细节变化，不保证长对白连续。

实测任务 `3b25ff16-cd26-4423-a807-2f0fa316780d`：RTX 5090 32GB，480P、24fps、每段 8 步，T2V 接 I2V。耗时 262.12 秒，MP4 864×480，音视频均 30.0 秒，显存监测峰值 31365 MiB，LoRA 尺寸错误 0。样片 `output/h3-fixed30.mp4`。该单次测试通过不代表所有输入都不会 OOM，也未建立修复前后同条件速度对照；修复的是加速权重加载，不应宣称额外提速倍数。参考图路径完成图结构测试，尚无本轮实际推理测速。

10Eros-INT8-Convrot 属于 LTX-2.3 的成人内容微调，与 H3 不兼容，本次未接入；不能将它作为 H3 LoRA 加载。

## Vercel 正式部署

2026-09-06 部署到现有项目 pencilstudio-videogame：
https://pencilstudio-videogame.vercel.app/video-studio

部署 ID：dpl_34i6U3bZePncRWhqwEg3ZwXWFesA。此次通过部署环境变量 DRAMA_COMFY_URL 连接 GPU 实例的 HTTPS 公网映射，无需本机 SSH 隧道。后续 CLI 重新部署需保留该环境变量（或在 Vercel 项目设置持久配置）。线上页面匿名请求 200，GPU health ready=true，已有 30 秒任务状态读取成功。

## 暗色分镜画布与 Grok Agent

/video-studio 和 /drama 现在共用暗色 React Flow 工作台。参考卡、场景卡支持文字设定与图片 URL，可拖线或通过检查器勾选关联镜头；关联文字进入实际提示词，T2V 关联图片时自动用 RI2V，I2V 保留首尾帧并使用卡片文字。镜头支持 15/30 秒、单镜生成和批量排队，项目导出包含卡片、位置与关联。旧独立页面历史从原本地存储迁移到画布，原数据仍保留。

剧本 Agent 默认 Grok 4.3，可选 Grok 4.6，支持 OpenRouter 和 xAI 官方两种密钥。浏览器输入的密钥仅在页面内存中使用、不导出、不持久保存；浏览器凭据只向对应的固定官方上游转发，不使用服务端代理地址。未填写时可回退至对应服务端密钥。真实 Grok 4.3 请求成功返回 4 个分镜、2 张设定卡。8 项测试和生产构建通过。

已将 DRAMA_COMFY_URL、OPENROUTER_API_KEY、OPENROUTER_BASE_URL 保存为 Vercel Production 环境变量；后续部署不再需要手动附加 GPU URL。OPENROUTER_MODEL 不决定此 Agent 的模型，Grok 型号由显式选择决定。

## 新实例迁移与画布编辑（2026-09-06）

生产与本地 DRAMA_COMFY_URL 已改为 https://u473272-82c4-17af3251.westc.seetacloud.com:8443。新实例 ComfyUI 监听 6006，10Eros 监听 6008；SSH `connect.westc.seetacloud.com:56079`。无需本地 SSH 隧道。

新增全选、多选删除、复制卡片/镜头、撤销/重做（本次页面会话最多50份画布快照）、清空确认及撤销恢复、整理布局、镜头前后移动、双击参考连线解除关联。快捷键：Delete/Backspace 删除，Cmd/Ctrl+D 复制，Cmd/Ctrl+A 全选，Cmd/Ctrl+Z 撤销，Cmd/Ctrl+Shift+Z 重做，Escape 取消选择；输入框保留正常文本操作。生成进行中暂停破坏性编辑；清空保留梗概和服务配置，不删除远程视频文件。复制不继承生成任务。旧页面记录仅迁移一次，避免清空后重新出现。

10项测试与生产构建通过；浏览器验证复制、多选删除、清空、撤销、重做和恢复成功。生产部署 dpl_GpPKcPax51xujQe5NBkyMSZsPo7h。

## 创作存档（2026-09-06）

参考卡与镜头仅通过检查器勾选关联，不再绘制参考连线。镜头顺序连线保留。

下载 `.pencil.zip` 包含 `project.json`（版本 2）、参考图片及已生成视频；素材读取失败会中止下载并提示，避免产出缺素材的存档。上传恢复会替换当前创作，兼容旧版本 JSON（旧 JSON 中的外部媒体链接仍需要可用）。本地草稿使用 IndexedDB，含恢复后的图片和视频，不再受 localStorage 小容量限制。密钥不进入存档。

Grok Image 2.0 默认 `resolution: 1K, quality: low, n: 1`。

### AutoDL 存档扩展安装

将 `scripts/gpu/pencil_archives.py` 安装至 `/root/ComfyUI/custom_nodes/pencil_archives.py`，在 `/root/.pencil-archive-token` 写入随机强密钥（权限 600），同值配置到 Vercel Production 的 `DRAMA_ARCHIVE_TOKEN`，然后在无运行任务时重启 ComfyUI。存档默认保存于 `/root/autodl-tmp/pencil-archives`，可用 `PENCIL_ARCHIVE_DIR` 覆盖。该数据盘不随实例镜像自动备份。

界面可存到 AutoDL、列出存档并恢复。上传与下载都以 512KiB 分片通过服务端代理，不直接暴露后端密钥。每次保存创建独立 ZIP，不覆盖已有存档。存档库通过随机恢复码隔离，换设备需在连接设置填写同一恢复码，请单独保存恢复码。未配置后端时明确返回 503，不影响本地存档下载和恢复。

本轮已准备扩展和代理；实际安装需当前实例可执行 shell 的 SSH 连接，旧端口转发密钥不能执行安装命令。

### 2026-09-10：完成安装并修复

`pencil_archives.py` 已安装到当前实例（`u473272-aegw-d69208c9.westd.seetacloud.com`）的 `/root/ComfyUI/custom_nodes/`，`/root/.pencil-archive-token` 已写入随机 64 位十六进制令牌（权限 600），已在无任务排队时重启 ComfyUI 加载。同一令牌已写入 Vercel Production / Preview / Development 的 `DRAMA_ARCHIVE_TOKEN`，并已用该配置重新部署生产环境。已通过生产环境 `/api/drama/archives` 完成保存分片、列出存档、按分片恢复并解包校验标题与镜头数的端到端验证，测试用存档与空存档库目录已清理。之前一直失败是因为该扩展从未在任何存活实例上真正安装过，且 Vercel 从未配置 `DRAMA_ARCHIVE_TOKEN`，服务端会直接返回 503。

## 2026-09-07：H3 / 10Eros LTX 服务选择

每镜可选择 H3 或 10Eros LTX；选择 LTX 时改为 I2V、15秒，并清空不支持的尾帧。首帧可从参考卡选择。任务保存 taskVideoModel，轮询和媒体路由不会随当前选择改变。

10Eros 使用现有 `/root/autodl-tmp/10Eros-backend/server.py` 的独立 FastAPI，运行于 6008。`start.sh` 默认端口改为6008，默认不再停止ComfyUI，原文件有 `.before-pencil` 备份。权重是 `10Eros_v1.2_bf16_ltx.safetensors`，运行时 fp8-cast 与 CPU offload；不是把原 INT8 工作流混入 H3。

ComfyUI 6006 加载 `scripts/gpu/pencil_ltx_bridge.py`：`/pencil/ltx/health`、`/pencil/ltx/i2v`、`/pencil/ltx/jobs/{id}`、视频子路径和 `/pencil/h3/prompt`。网站提交会自动让出显存：LTX 提交先中断并清空 H3 队列、卸载 H3 权重；H3 提交先调用 `/v1/release`（或 `/v1/unload`）取消 LTX 任务并卸管线。同族 LTX 仍一次只跑一条。其他直接使用 ComfyUI 原生 `/prompt` 的客户端不受这一网站网关控制。

LTX当前支持单首帧、361帧/24fps（15.04秒）、单镜头、短边512；尺寸为横屏896×512、竖屏512×896、方形512×512，按模型64倍数对齐。多参考图、尾帧及30秒未接入。负面提示词仍为自然语言约束；未声明蒸馏pipeline支持独立负向条件。

## 2026-09-07：Sulphur 2 成人向 T2V

成人向分镜默认走 **Sulphur 2 · LTX-2.3 文生视频**（`ltx-sulphur`），不必先出首帧。10Eros 仍是同族 **I2V**。32GB 不宜再加载一套 29GB Sulphur 权重；T2V 复用已加载的 LTX/10Eros pipeline，`images=[]`。

网站提交 `POST /pencil/ltx/t2v` → 10Eros `:6008/v1/t2v`。健康检查把 `ltx.t2v` 传给工作台；未安装时选项显示「T2V 未就绪」。

安装（需可执行 shell 的 SSH，端口转发密钥不能装）：

```sh
# ComfyUI 节点：覆盖 pencil_ltx_bridge.py 后重启 ComfyUI
# 10Eros 后端：
cp scripts/gpu/pencil_sulphur_t2v.py /root/autodl-tmp/10Eros-backend/
cd /root/autodl-tmp/10Eros-backend
python pencil_sulphur_t2v.py --install server.py
# 重启 6008
```

可选 `PENCIL_SULPHUR_MODEL` 指向 `sulphur_dev_fp8mixed.safetensors`；与 10Eros 权重互斥，默认不换权重。

实际集成测试任务 c5027c9bd6e9：768×512、361帧、15.041667秒，耗时107.8秒；视频下载与抽帧通过，样片 `output/ltx-integration-test.mp4`。网页默认横竖尺寸随后调整为更接近16:9/9:16的64倍数。模型初次加载耗时包含在本次测试内，不是性能保证。

日志：`/root/autodl-tmp/10Eros-backend/logs/pencil-api.log`、`/root/pencil-comfy-ltx-bridge.log`。当前独立后端任务索引仍在进程内存，重启LTX API后旧任务查询不可恢复，已下载的视频/完整存档不受影响。

## 2026-09-08：PinkCherry 默认成人向

成人向自动选择优先 **PinkCherry v1.8**（`ltx-pinkcherry`）：无首帧走 T2V，有首帧走 I2V，绑定角色/场景参考图走 RI2V（第一张图作为 LTX 条件图，其余写入提示词）。权重未下载时才回退 Sulphur T2V / 10Eros I2V / H3 RI2V。30 秒、尾帧、音视频参考仍走 H3。

Q8_0 GGUF 与 bf16 都用 `hf download hf://SexGod1979/PinkCherry_NSFW_LTX23/v1.8/...`。6008 的 DistilledPipeline 加载 bf16；GGUF 只软链接到 ComfyUI `unet/`，供 `GGUFLoaderKJ` 使用。

```sh
bash scripts/gpu/download_pinkcherry.sh
cp scripts/gpu/pencil_pinkcherry.py /root/autodl-tmp/10Eros-backend/
cp scripts/gpu/pencil_ltx_bridge.py /root/ComfyUI/custom_nodes/
cd /root/autodl-tmp/10Eros-backend
python pencil_pinkcherry.py --install server.py
# 重启 6008 与 ComfyUI
```

健康检查增加 `ltx.pinkcherry`。生成时 `?checkpoint=pinkcherry` 会先 `/v1/release` 卸当前管线再切权重；切回 10Eros/Sulphur 时同样切回 `10eros`。H3 ↔ LTX 切换不再因对方队列占用而 409。

### H3 video and audio references

H3 RI2V now accepts per-shot MP4/MOV video and WAV/MP3 audio attachments. Each type supports at most three clips with a combined duration of 15 seconds; each clip must be 2–15 seconds. Audio requires an image or video reference. Use `Video 1` and `Audio 1` in prompts. Video soundtrack is not implicitly passed; upload the desired audio separately. Other model/provider combinations reject these attachments rather than silently ignoring them.

The browser uploads in 1 MiB chunks through `/api/drama/reference-media`. Install `scripts/gpu/pencil_reference_media.py` into ComfyUI custom_nodes and restart only when idle. Media persists under ComfyUI input/pencil_refs, with PyAV validation and metadata. `PencilLoadReferenceVideo` samples video at 24 FPS, caps the longest side at 512px and frames at 360; standalone audio uses the native LoadAudio node. Assets are included in ZIP exports and local drafts; restored blob assets are uploaded again before generation. These files depend on the AutoDL disk; download an archive for portability. Partial interrupted uploads may leave `.bin` files that can be cleaned when no uploads are active.

Validation: H3 generated task `4cbf12d1-20ef-465a-9595-6452774f531f` from a 2-second moving-square video and 2-second tone. Output `pencil/drama_00024_.mp4` includes a 15.083-second video track and 15.075-second audio track. The test verifies successful multimodal inference, not exact motion or audio replication. Reference count/duration, visual requirement, mode restrictions, graph inputs and archive preservation are covered by tests.
